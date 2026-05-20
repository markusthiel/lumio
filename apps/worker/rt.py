"""
Real-time Event Publisher — defensiver Wrapper um events.py.

Hintergrund: Der echte Publisher ist events.py. Aber egal warum — sei
es ein Deploy-Hickup, ein fehlendes Modul, ein kaputter Redis-Client —
ein Fehler beim Publishen DARF NIE die File-Pipeline aborten. Echtzeit
ist nice-to-have; ein "ready"-File ist Pflicht.

Die Bug-History: Production lief in einer Konstellation, in der
`from events import file_status` mit `ModuleNotFoundError` warf.
Das wurde im except-Branch der Tasks aufgerufen — als Side-Effect des
mark_file_failed — und resultierte in einem cascading failure, der
*alle* 83 Files einer frisch hochgeladenen Galerie als 'failed'
markierte, obwohl das eigentliche Processing erfolgreich war.

Lösung: hier zentral importieren, exception swallowen, und die Funktion
file_status() als No-Op exportieren, falls der Import nicht klappt.
"""
from __future__ import annotations

import structlog

log = structlog.get_logger(__name__)

try:
    from events import file_status as _real_file_status  # noqa: F401

    def file_status(
        gallery_id: str,
        file_id: str,
        status: str,
        width: int | None = None,
        height: int | None = None,
    ) -> None:
        try:
            _real_file_status(
                gallery_id, file_id, status, width=width, height=height
            )
        except Exception as err:
            # Auch der Publisher selbst kann werfen (Redis down etc.).
            # Wir loggen einmal warn und schlucken — die Pipeline läuft
            # weiter.
            log.warn(
                "rt.publish_failed",
                gallery_id=gallery_id, file_id=file_id,
                status=status, err=str(err),
            )

except Exception as err:  # noqa: BLE001
    # events-Modul nicht ladbar (alter Container, Deploy-Glitch, etc.):
    # Pipeline darf nicht stoppen. Wir loggen einmal beim Import, dann
    # ist file_status() ein No-Op für den Rest der Worker-Lifetime.
    log.warn("rt.module_unavailable", err=str(err))

    def file_status(  # type: ignore[no-redef]
        gallery_id: str,
        file_id: str,
        status: str,
        width: int | None = None,
        height: int | None = None,
    ) -> None:
        # bewusst leer
        return None
