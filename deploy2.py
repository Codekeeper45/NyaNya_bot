import paramiko
import os

host = 'node1.serverix.cloud'
port = 2022
username = 'yapparovemir_earr.9edffbfc'
password = 'guitaR321'
remote_base = '/home/yapparovemir_earr.9edffbfc/opekun'

files = [
    '.env.example',
    'chat-viewer.mjs',
    'package-lock.json',
    'package.json',
    'src/agent/models.ts',
    'src/agent/orchestrator.test.ts',
    'src/agent/orchestrator.ts',
    'src/agent/prompts/system.ts',
    'src/agent/tools/index.ts',
    'src/agent/tools/schedule.test.ts',
    'src/agent/tools/schedule.ts',
    'src/bot/handlers/commands.ts',
    'src/bot/handlers/message.ts',
    'src/bot/handlers/voice.ts',
    'src/call/dialogue.ts',
    'src/call/server.ts',
    'src/config.ts',
    'src/e2e/commands.test.ts',
    'src/e2e/proactive.test.ts',
    'src/e2e/tools-schedule.test.ts',
    'src/graphrag/indexer.test.ts',
    'src/graphrag/indexer.ts',
    'src/index.ts',
    'src/scheduler/worker.test.ts',
    'src/scheduler/worker.ts',
    'src/test/fixtures.ts',
    'src/test/mock-repos.ts',
    'src/voice/tts.ts',
    'dist/index.js',
]

transport = paramiko.Transport((host, port))
transport.connect(username=username, password=password)
sftp = paramiko.SFTPClient.from_transport(transport)

for f in files:
    local_path = f
    remote_path = remote_base + '/' + f
    remote_dir = os.path.dirname(remote_path)
    
    # Create dirs
    dirs = []
    d = remote_dir
    while d != remote_base:
        dirs.append(d)
        d = os.path.dirname(d)
    dirs.reverse()
    for d in dirs:
        try:
            sftp.stat(d)
        except FileNotFoundError:
            sftp.mkdir(d)
    
    sftp.put(local_path, remote_path)
    print(f'Uploaded {f}')

sftp.close()
transport.close()
print('Done')
