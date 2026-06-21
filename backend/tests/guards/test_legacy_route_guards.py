"""
Guard tests: Legacy route and runtime secret absence checks.

These tests verify old flat route mounts, runtime secret fields, and
Environment.isActive have been removed and stay removed. They also verify
old flat endpoints return 404.

If any of these guards fail, old patterns have been reintroduced --- reject
the change and ensure scoped equivalents are used instead.
"""

import subprocess  # noqa: S404 --- used for grep guards only
from pathlib import Path

# Paths
BACKEND_APP = Path(__file__).resolve().parent.parent.parent / "app"


# =========================================================================
# Grep-based guards
# =========================================================================


def _grep_production(pattern: str) -> list[str]:
    """Run grep over backend/app recursively, return matching lines."""
    cmd = [
        "powershell",
        "-Command",
        f'Select-String -Path "{BACKEND_APP}\\**\\*.py" -Pattern "{pattern}" '
        f"-CaseSensitive | Select-Object -ExpandProperty Line",
    ]
    try:
        output = subprocess.check_output(  # noqa: S603,S607
            cmd, text=True, stderr=subprocess.STDOUT
        )
        return [line.strip() for line in output.splitlines() if line.strip()]
    except subprocess.CalledProcessError:
        return []


class TestGrepGuards:
    """Forbidden patterns must NOT appear in backend/app production code."""

    def test_no_flat_workflows_router_mount(self) -> None:
        """Flat /api/workflows router must not be included in main.py."""
        main_py = BACKEND_APP / "main.py"
        content = main_py.read_text(encoding="utf-8")
        lines = [
            line.strip()
            for line in content.splitlines()
            if "include_router(workflows.router)" in line
        ]
        assert not lines, (
            "Flat workflows.router is still mounted in main.py. "
            "Use workspace-scoped workflows instead."
        )

    def test_no_flat_environments_router_mount(self) -> None:
        """Flat /api/environments router must not be included in main.py."""
        main_py = BACKEND_APP / "main.py"
        content = main_py.read_text(encoding="utf-8")
        lines = [
            line.strip()
            for line in content.splitlines()
            if "include_router(environments.router)" in line
        ]
        assert not lines, (
            "Flat environments.router is still mounted in main.py. "
            "Use scoped environments instead."
        )

    def test_no_flat_collections_router_mount(self) -> None:
        """Flat /api/collections router must not be included in main.py."""
        main_py = BACKEND_APP / "main.py"
        content = main_py.read_text(encoding="utf-8")
        lines = [
            line.strip()
            for line in content.splitlines()
            if "include_router(collections.router)" in line
        ]
        assert not lines, (
            "Flat collections.router is still mounted in main.py. " "Projects replace collections."
        )

    def test_no_flat_router_import_in_main(self) -> None:
        """Old flat router names must not appear as standalone imports in main.py."""
        main_py = BACKEND_APP / "main.py"
        content = main_py.read_text(encoding="utf-8")
        import_line = next(
            (line for line in content.splitlines() if "from app.routes import" in line),
            "",
        )
        # Check exact name by looking for the module name bounded by comma/space/end
        tokens = [t.strip().rstrip(",") for t in import_line.split("import")[-1].split(",")]
        tokens = [t.strip() for t in tokens if t.strip()]
        forbidden = {"workflows", "environments", "collections"}
        found = [t for t in tokens if t in forbidden]
        assert not found, (
            f"Old flat router(s) still imported in main.py: {found}. "
            "Remove the import to prevent accidental remounting."
        )

    def test_no_runtime_secrets_in_app_code(self) -> None:
        """The string 'runtime_secret' must not appear in backend/app source."""
        matches = _grep_production("runtime_secret")
        assert not matches, (
            f"Found {len(matches)} occurrences of 'runtime_secret' in backend/app:\n"
            + "\n".join(matches[:10])
            + "\nRuntime/ad-hoc secrets are not supported. Remove them."
        )

    def test_no_environment_isactive_field_in_models(self) -> None:
        """Environment model must not have an 'isActive' *field* declaration.

        Only checks for actual field assignments (isActive: type or isActive=value),
        not docstring comments. ScopedKeypair.isActive is allowed (key activation).
        """
        models_py = BACKEND_APP / "models.py"
        content = models_py.read_text(encoding="utf-8")
        lines = content.splitlines()
        in_environment = False
        found_is_active = False
        for line in lines:
            stripped = line.strip()
            if stripped.startswith("class Environment("):
                in_environment = True
                continue
            if in_environment and stripped.startswith("class "):
                in_environment = False
                continue
            if not in_environment:
                continue
            # Only match actual field declarations (isActive: or isActive =)
            if "isActive:" in stripped or "isActive =" in stripped:
                # Verify not a comment line
                before_comment = stripped.split("#")[0]
                if "isActive:" in before_comment or "isActive =" in before_comment:
                    found_is_active = True
                    break
        assert not found_is_active, (
            "Environment model still has 'isActive' field. "
            "Scoped environments replace the global active-environment concept."
        )


# =========================================================================
# Old-endpoint absence checks (via main.py analysis)
# =========================================================================


class TestOldEndpointsNotMounted:
    """Old flat route prefixes must NOT be mounted.

    These tests check main.py's include_router() calls rather than making
    HTTP requests, because the full app has pre-existing FastAPI-level
    import bugs unrelated to flat-route removal.
    """

    def test_workflows_not_mounted_in_main(self) -> None:
        """include_router(workflows.router) must be absent from main.py."""
        main_py = BACKEND_APP / "main.py"
        content = main_py.read_text(encoding="utf-8")
        assert "include_router(workflows.router)" not in content

    def test_environments_not_mounted_in_main(self) -> None:
        """include_router(environments.router) must be absent from main.py."""
        main_py = BACKEND_APP / "main.py"
        content = main_py.read_text(encoding="utf-8")
        assert "include_router(environments.router)" not in content

    def test_collections_not_mounted_in_main(self) -> None:
        """include_router(collections.router) must be absent from main.py."""
        main_py = BACKEND_APP / "main.py"
        content = main_py.read_text(encoding="utf-8")
        assert "include_router(collections.router)" not in content

    def test_scoped_routers_mounted(self) -> None:
        """Sanity: key scoped routers ARE still mounted."""
        main_py = BACKEND_APP / "main.py"
        content = main_py.read_text(encoding="utf-8")
        assert "include_router(orgs.router)" in content
        assert "include_router(workspaces.router)" in content
        assert "include_router(projects.router)" in content
        assert "include_router(keys.router)" in content
        assert "include_router(scoped_environments.router)" in content
        assert "include_router(secrets.router)" in content
