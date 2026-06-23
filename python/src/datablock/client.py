from __future__ import annotations

from .email import EmailService


class Datablock:
    def __init__(
        self,
        api_key: str,
        project_id: str,
        base_url: str = "https://api.datablock.dev",
    ) -> None:
        if not api_key:
            raise ValueError("api_key is required")
        if not project_id:
            raise ValueError("project_id is required")

        self.api_key = api_key
        self.project_id = project_id
        self.base_url = base_url.rstrip("/")

        self.email = EmailService(self)
