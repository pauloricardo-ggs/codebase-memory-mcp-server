from pathlib import Path
import sys


main_file = Path(sys.argv[1] if len(sys.argv) > 1 else "/app/backend/open_webui/main.py")
source = main_file.read_text()

config_keys_before = """        'google_drive.enable',
        'onedrive.enable',"""
config_keys_after = """        'google_drive.enable',
        'google_drive.client_id',
        'google_drive.api_key',
        'onedrive.enable',"""

response_before = """                'google_drive': {
                    'client_id': GOOGLE_DRIVE_CLIENT_ID,
                    'api_key': GOOGLE_DRIVE_API_KEY,
                },"""
response_after = """                'google_drive': {
                    'client_id': config.get('google_drive.client_id'),
                    'api_key': config.get('google_drive.api_key'),
                },"""

for before, after, description in (
    (config_keys_before, config_keys_after, "lista pública de configurações"),
    (response_before, response_after, "resposta do Google Drive"),
):
    occurrences = source.count(before)
    if occurrences != 1:
        raise RuntimeError(
            f"Patch incompatível com {main_file}: esperado 1 trecho para {description}, encontrado {occurrences}."
        )
    source = source.replace(before, after)

main_file.write_text(source)
