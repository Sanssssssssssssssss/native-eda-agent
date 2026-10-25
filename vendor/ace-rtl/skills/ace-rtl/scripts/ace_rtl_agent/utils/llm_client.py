# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""
Robust LLM client with retry logic and prompt management.
"""

import logging
import os
import random
import time
from pathlib import Path
from typing import Dict, Optional

from ..llm_backend import LLMBackend, enforce_prompt_char_budget, resolve_model_name


MAX_BACKOFF_SECONDS = 60


class LLMClient:
    """
    Reliable interface to the configured external LLM service.

    Supported providers:
    - NVIDIA Inference API through the NVIDIA-supported Python client interface.
    - A user-provided adapter script via `ACE_RTL_LLM_SCRIPT`.
    """

    def __init__(
        self,
        model: str,
        api_key: Optional[str] = None,
        max_retries: int = 3,
        initial_backoff: float = 5.0,
        logger: Optional[logging.Logger] = None,
    ):
        self.model = model
        self.max_retries = max_retries
        self.initial_backoff = initial_backoff
        self.logger = logger or logging.getLogger(__name__)

        self.logger.info(
            "LLMClient initialized: model=%s, max_retries=%s, initial_backoff=%s",
            model,
            max_retries,
            initial_backoff,
        )

        self.client = self._setup_client(api_key)
        self._prompt_cache: Dict[str, str] = {}
        self.prompts_dir = self._find_prompts_directory()

    def _setup_client(self, api_key: Optional[str] = None) -> LLMBackend:
        resolved_model = resolve_model_name(self.model)
        if api_key:
            os.environ["NVIDIA_API_KEY"] = api_key
        try:
            client = LLMBackend(model=resolved_model)
            self.logger.info("LLM backend initialized for model: %s", self.model)
            return client
        except ValueError as e:
            self.logger.error("Failed to initialize LLM backend: %s", e)
            raise

    @staticmethod
    def _is_context_window_error(error: Exception) -> bool:
        error_text = str(error).lower()
        return any(
            marker in error_text
            for marker in [
                "contextwindowexceeded",
                "context window",
                "context_window",
                "maximum context length",
                "too many tokens",
                "please reduce the length",
            ]
        )

    def _shrink_prompt_after_context_error(self, prompt: str) -> str:
        try:
            target_chars = int(os.environ.get("ACE_RTL_CONTEXT_RETRY_PROMPT_CHARS", "120000"))
        except ValueError:
            target_chars = 120000
        target_chars = max(40000, min(target_chars, int(len(prompt) * 0.70)))

        if len(prompt) <= target_chars:
            return prompt

        marker = "\n\n... [PROMPT FURTHER TRUNCATED after provider context-window rejection] ...\n\n"
        keep = max(1000, target_chars - len(marker))
        head = int(keep * 0.55)
        tail = keep - head
        shrunk = prompt[:head] + marker + prompt[-tail:]
        self.logger.warning(
            "Provider rejected prompt for context length; shrunk prompt from %s to %s chars",
            len(prompt),
            len(shrunk),
        )
        return shrunk

    def _find_prompts_directory(self) -> Path:
        current_dir = Path(__file__).parent
        possible_paths = [
            current_dir / "../../../prompts",
            current_dir / "../../prompts",
            current_dir / "../prompts",
            current_dir / "prompts",
            Path.cwd() / "prompts",
        ]

        for path in possible_paths:
            resolved_path = path.resolve()
            if resolved_path.exists() and resolved_path.is_dir():
                self.logger.info("Found prompts directory: %s", resolved_path)
                return resolved_path

        fallback_path = current_dir.parent / "prompts"
        self.logger.debug("Prompts directory not found, using fallback path: %s", fallback_path)
        return fallback_path

    def load_prompt_template(self, template_name: str, **kwargs) -> str:
        cache_key = f"{template_name}_{hash(str(sorted(kwargs.items())))}"
        if cache_key in self._prompt_cache:
            return self._prompt_cache[cache_key]

        template_path = self.prompts_dir / f"{template_name}.md"
        if not template_path.exists():
            self.logger.error("Prompt template not found: %s", template_path)
            raise FileNotFoundError(f"Prompt template not found: {template_path}")

        try:
            template_content = template_path.read_text(encoding="utf-8")
            formatted_prompt = template_content.format(**kwargs)
            self._prompt_cache[cache_key] = formatted_prompt
            self.logger.debug("Loaded and formatted prompt template: %s", template_name)
            return formatted_prompt
        except Exception as e:
            self.logger.error("Error loading prompt template %s: %s", template_name, e)
            raise

    def _is_transient_error(self, error: Exception) -> bool:
        error_text = str(error).lower()
        if "non_retryable" in error_text:
            return False
        transient_indicators = [
            "timeout",
            "timed out",
            "http/1.1 429",
            "429 ",
            "code': '429'",
            "code\": \"429\"",
            "529",
            "overloaded",
            "queue requests limit reached",
            "request limit reached",
            "limit reached",
            "500",
            "502",
            "503",
            "504",
            "upstream connect error",
            "connection failure",
            "connection reset",
            "temporarily unavailable",
            "rate limit",
            "too many requests",
            "empty response",
            "contextwindowexceeded",
            "context length",
            "context_window",
            "maximum context length",
            "reduce the length",
            "too many tokens",
        ]
        return any(indicator in error_text for indicator in transient_indicators)

    def call_llm(
        self,
        prompt: str,
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        timeout: Optional[int] = None,
    ) -> Optional[str]:
        last_error = None
        backoff_time = self.initial_backoff
        working_prompt = enforce_prompt_char_budget(prompt, self.model, self.logger)
        context_shrink_used = False

        self.logger.info("LLMClient: Starting retry loop with max_retries=%s", self.max_retries)
        for attempt in range(self.max_retries + 1):
            try:
                self.logger.info(
                    "LLMClient: Calling model %s (attempt %s/%s)",
                    self.model,
                    attempt + 1,
                    self.max_retries + 1,
                )
                response = self.client.prompt(
                    working_prompt,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
                if response:
                    content = response.strip()
                    self.logger.info("Received LLM response, length: %s", len(content))
                    return content
                raise ValueError("Empty response from the model")

            except Exception as e:
                last_error = e
                is_reasoning_exhausted = "non_retryable" in str(e).lower()
                is_context_window = self._is_context_window_error(e)

                if is_context_window and not context_shrink_used and attempt < self.max_retries:
                    context_shrink_used = True
                    working_prompt = self._shrink_prompt_after_context_error(working_prompt)
                    self.logger.warning(
                        "Context-window rejection is deterministic; retrying once with a smaller prompt."
                    )
                    continue

                if is_reasoning_exhausted:
                    self.logger.error(
                        "Model exhausted the output budget while reasoning; not retrying this call."
                    )
                    break

                if attempt >= self.max_retries:
                    self.logger.error("LLM call failed after all retries: %s", e)
                    break

                if not self._is_transient_error(e):
                    self.logger.error("Non-transient error encountered: %s", e)
                    break

                jitter = random.uniform(0.8, 1.2)
                wait_time = min(backoff_time, MAX_BACKOFF_SECONDS) * jitter
                self.logger.warning("Transient error: %s. Retrying in %.2fs...", e, wait_time)
                time.sleep(wait_time)
                backoff_time = min(backoff_time * 2, MAX_BACKOFF_SECONDS)

        self.logger.error("LLM call failed after %s attempts: %s", self.max_retries + 1, last_error)
        return None

    def correct_rtl_code(self, specification: str, buggy_code: str, error_report: str) -> Optional[str]:
        self.logger.info("Generating corrected RTL code based on error report")
        try:
            prompt = self.load_prompt_template(
                "rtl_error_correction",
                specification=specification,
                buggy_code=buggy_code,
                error_report=error_report,
            )
            return self.call_llm(prompt)
        except Exception as e:
            self.logger.error("Error correcting RTL code: %s", e)
            return None
