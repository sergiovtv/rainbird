#!/usr/bin/env python3
"""Painel local e privado para um controlador Rain Bird."""

from __future__ import annotations

import asyncio
import dataclasses
import ipaddress
import json
from pathlib import Path
from typing import Any

import aiohttp
from aiohttp import web
from pyrainbird import async_client


ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
HOST = "127.0.0.1"
PORT = 8787


class RainBirdService:
    def __init__(self) -> None:
        self.host: str | None = None
        self.password: str | None = None
        self.lock: asyncio.Lock | None = None

    def configured(self) -> bool:
        return bool(self.host and self.password)

    async def controller(self, session: aiohttp.ClientSession):
        if not self.configured():
            raise web.HTTPUnauthorized(text="Informe o IP e o PIN do controlador.")
        # A versão estável publicada expõe uma fábrica antiga com um defeito que
        # envolve o cliente local em uma tupla. Instanciar as duas classes
        # diretamente mantém a comunicação local correta no Python do macOS.
        local_client = async_client.AsyncRainbirdClient(
            session, self.host, self.password
        )
        return async_client.AsyncRainbirdController(local_client)

    async def call(self, method: str, *args: Any) -> Any:
        if self.lock is None:
            # O servidor do aiohttp cria seu loop depois de importar este módulo.
            # Criar o lock aqui garante que ele pertença ao loop correto.
            self.lock = asyncio.Lock()
        async with self.lock:
            timeout = aiohttp.ClientTimeout(total=12)
            connector = aiohttp.TCPConnector(limit=1, ssl=False)
            async with aiohttp.ClientSession(timeout=timeout, connector=connector) as session:
                controller = await self.controller(session)
                return await getattr(controller, method)(*args)


service = RainBirdService()


def jsonable(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if dataclasses.is_dataclass(value):
        return {key: jsonable(item) for key, item in dataclasses.asdict(value).items()}
    if hasattr(value, "dict"):
        return jsonable(value.dict())
    if isinstance(value, dict):
        return {str(key): jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set, frozenset)):
        return [jsonable(item) for item in value]
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def error_response(exc: Exception) -> web.Response:
    message = str(exc).strip() or exc.__class__.__name__
    lowered = message.lower()
    if "password" in lowered or "decrypt" in lowered or "padding" in lowered:
        message = "PIN incorreto ou resposta inválida do controlador."
    elif isinstance(exc, (asyncio.TimeoutError, aiohttp.ClientError)):
        message = "O Rain Bird não respondeu. Confirme o IP e a rede Wi-Fi."
    return web.json_response({"ok": False, "error": message}, status=400)


async def index(_: web.Request) -> web.FileResponse:
    return web.FileResponse(STATIC / "index.html")


async def api_config(_: web.Request) -> web.Response:
    return web.json_response(
        {
            "ok": True,
            "configured": service.configured(),
            "host": service.host or "192.168.15.176",
        }
    )


async def api_connect(request: web.Request) -> web.Response:
    try:
        body = await request.json()
        host = str(body.get("host", "")).strip()
        password = str(body.get("password", "")).strip()
        ipaddress.ip_address(host)
        if not 4 <= len(password) <= 16:
            raise ValueError("O PIN deve ter entre 4 e 16 caracteres.")

        old_host, old_password = service.host, service.password
        service.host, service.password = host, password
        try:
            # O ESP-RZXe responde ao modelo e às zonas, mas algumas revisões
            # retornam NAK para ControllerFirmwareVersionRequest.
            model = await service.call("get_model_and_version")
            stations = await service.call("get_available_stations")
            try:
                firmware = await service.call("get_controller_firmware_version")
            except Exception:
                firmware = None
        except Exception:
            service.host, service.password = old_host, old_password
            raise

        return web.json_response(
            {
                "ok": True,
                "model": jsonable(model),
                "firmware": jsonable(firmware),
                "stations": jsonable(stations),
            }
        )
    except Exception as exc:
        return error_response(exc)


async def api_status(_: web.Request) -> web.Response:
    try:
        stations = await service.call("get_available_stations")
        states = await service.call("get_zone_states")
        rain_delay = await service.call("get_rain_delay")
        try:
            network = await service.call("get_network_status")
        except Exception:
            network = None
        return web.json_response(
            {
                "ok": True,
                "host": service.host,
                "stations": jsonable(stations),
                "states": jsonable(states),
                "rainDelay": jsonable(rain_delay),
                "network": jsonable(network),
            }
        )
    except Exception as exc:
        return error_response(exc)


async def api_start(request: web.Request) -> web.Response:
    try:
        body = await request.json()
        zone = int(body.get("zone", 0))
        minutes = int(body.get("minutes", 0))
        if zone not in range(1, 5):
            raise ValueError("Zona inválida.")
        if minutes not in range(1, 121):
            raise ValueError("Escolha entre 1 e 120 minutos.")
        await service.call("irrigate_zone", zone, minutes)
        return web.json_response({"ok": True, "zone": zone, "minutes": minutes})
    except Exception as exc:
        return error_response(exc)


async def api_stop(_: web.Request) -> web.Response:
    try:
        await service.call("stop_irrigation")
        return web.json_response({"ok": True})
    except Exception as exc:
        return error_response(exc)


async def api_disconnect(_: web.Request) -> web.Response:
    service.password = None
    return web.json_response({"ok": True})


def create_app() -> web.Application:
    app = web.Application(client_max_size=16 * 1024)
    app.router.add_get("/", index)
    app.router.add_get("/api/config", api_config)
    app.router.add_post("/api/connect", api_connect)
    app.router.add_get("/api/status", api_status)
    app.router.add_post("/api/start", api_start)
    app.router.add_post("/api/stop", api_stop)
    app.router.add_post("/api/disconnect", api_disconnect)
    app.router.add_static("/static", STATIC)
    return app


if __name__ == "__main__":
    print(f"Painel Rain Bird disponível em http://localhost:{PORT}")
    web.run_app(create_app(), host=HOST, port=PORT, print=None)
