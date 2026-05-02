import paramiko
import os
import sys

host = 'node1.serverix.cloud'
port = 2022
username = 'yapparovemir_earr.9edffbfc'
password = 'guitaR321'
remote_base = '/home/yapparovemir_earr.9edffbfc/opekun'
local_base = '.'

exclude = {'.git', 'node_modules', '.agent', '.planning', '.gsd', '.claude', '.cache'}

def should_upload(rel_path):
    parts = rel_path.split(os.sep)
    for part in parts:
        if part in exclude:
            return False
    return True

transport = paramiko.Transport((host, port))
transport.connect(username=username, password=password)
sftp = paramiko.SFTPClient.from_transport(transport)

# Ensure remote base exists
try:
    sftp.stat(remote_base)
except FileNotFoundError:
    sftp.mkdir(remote_base)

uploaded = 0
for root, dirs, files in os.walk(local_base):
    # Filter out excluded dirs
    dirs[:] = [d for d in dirs if d not in exclude]
    
    rel_root = os.path.relpath(root, local_base)
    if rel_root == '.':
        rel_root = ''
    
    if not should_upload(rel_root):
        continue
    
    remote_root = os.path.join(remote_base, rel_root).replace('\\', '/')
    
    # Create remote directory
    try:
        sftp.stat(remote_root)
    except FileNotFoundError:
        sftp.mkdir(remote_root)
    
    for file in files:
        local_path = os.path.join(root, file)
        rel_path = os.path.join(rel_root, file) if rel_root else file
        
        if not should_upload(rel_path):
            continue
        
        remote_path = os.path.join(remote_root, file).replace('\\', '/')
        sftp.put(local_path, remote_path)
        uploaded += 1
        if uploaded % 50 == 0:
            print(f'Uploaded {uploaded} files...')

sftp.close()
transport.close()
print(f'Deploy complete: {uploaded} files uploaded')
