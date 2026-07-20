import asyncio
import importlib.util
import sys
import types
import unicodedata


class Files:
    pass


files_module = types.ModuleType('open_webui.models.files')
files_module.Files = Files
open_webui_module = types.ModuleType('open_webui')
open_webui_module.__path__ = []
models_module = types.ModuleType('open_webui.models')
models_module.__path__ = []
sys.modules['open_webui'] = open_webui_module
sys.modules['open_webui.models'] = models_module
sys.modules['open_webui.models.files'] = files_module

citation_spec = importlib.util.spec_from_file_location(
    'open_webui.google_drive_citations',
    '/app/backend/open_webui/google_drive_citations.py',
)
citation_module = importlib.util.module_from_spec(citation_spec)
citation_spec.loader.exec_module(citation_module)
sys.modules['open_webui.google_drive_citations'] = citation_module

spec = importlib.util.spec_from_file_location(
    'knowledge_fs_patch_target',
    '/app/backend/open_webui/tools/knowledge_fs.py',
)
knowledge_fs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(knowledge_fs)


class FakeFile:
    id = 'file-1'
    filename = 'Cópia de Documentação Técnica.txt'
    data = {'content': 'conteúdo encontrado'}
    meta = {
        'content_type': 'text/plain',
        'data': {
            'source': 'google-drive',
            'source_name': 'Documentação Técnica',
            'source_url': 'https://drive.google.com/open?id=drive-file-1',
        },
    }
    updated_at = 1
    created_at = 1


async def fake_get_accessible_files(user, model_knowledge, knowledge_id=None):
    return [
        {
            'id': 'file-1',
            'filename': FakeFile.filename,
            'directory_id': 'directory-1',
            'knowledge_id': 'kb-1',
            'knowledge_name': 'Knowledge Base Sample',
        }
    ]


async def fake_build_directory_tree(knowledge_id):
    assert knowledge_id == 'kb-1'
    return {
        'files': [
            {
                'id': 'file-1',
                'path': 'Google Drive (gerenciado)/teste--abc/Cópia de Documentação Técnica.txt',
                'filename': FakeFile.filename,
                'directory_id': None,
            }
        ],
        'dirs': {},
    }


async def fake_get_file_by_id(file_id):
    return FakeFile() if file_id == 'file-1' else None


async def fake_resolve_dir_path(path, knowledge_id):
    return None


async def fake_get_accessible_kb_ids(user, model_knowledge, knowledge_id=None):
    return [('kb-1', 'Knowledge Base Sample', '')]


async def main():
    knowledge_fs._get_accessible_files = fake_get_accessible_files
    knowledge_fs._get_accessible_kb_ids = fake_get_accessible_kb_ids
    knowledge_fs._build_directory_tree = fake_build_directory_tree
    knowledge_fs._resolve_dir_path = fake_resolve_dir_path
    Files.get_file_by_id = fake_get_file_by_id

    abbreviated = unicodedata.normalize(
        'NFD', 'teste--abc/Cópia de Documentação Técnica.txt'
    )
    resolved = await knowledge_fs._resolve_file(abbreviated, {'id': 'user-1'}, [])

    assert resolved['id'] == 'file-1'
    assert resolved['content'] == 'conteúdo encontrado'

    combined = (
        'Google Drive (gerenciado)/teste--abc/file-1/'
        'Cópia de Documentação Técnica.txt'
    )
    resolved_with_embedded_id = await knowledge_fs._resolve_file(
        combined, {'id': 'user-1'}, []
    )
    assert resolved_with_embedded_id['id'] == 'file-1'

    tree_output = await knowledge_fs._kb_tree([], {'a'}, {'id': 'user-1'}, [])
    assert 'path="Google Drive (gerenciado)/teste--abc/Cópia de Documentação Técnica.txt"' in tree_output
    assert 'file_id="file-1"' in tree_output
    assert '/file-1/Cópia de Documentação Técnica.txt' not in tree_output

    sources = await knowledge_fs.get_kb_exec_citation_sources(
        f'cat -n "{combined}"', {'id': 'user-1'}, []
    )
    assert len(sources) == 1
    assert sources[0]['source'] == {
        'id': 'file-1',
        'name': 'Documentação Técnica',
        'type': 'file',
        'url': 'https://drive.google.com/open?id=drive-file-1',
    }
    assert sources[0]['metadata'][0]['source'] == 'https://drive.google.com/open?id=drive-file-1'


asyncio.run(main())
