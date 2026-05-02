import paramiko
import os

host = 'node1.serverix.cloud'
port = 2022
username = 'yapparovemir_earr.9edffbfc'
password = 'guitaR321'
remote_base = '/home/yapparovemir_earr.9edffbfc/opekun'

transport = paramiko.Transport((host, port))
transport.connect(username=username, password=password)
sftp = paramiko.SFTPClient.from_transport(transport)

stat = sftp.stat(remote_base + '/dist/index.js')
print(f'dist/index.js size: {stat.st_size} bytes')
print(f'dist/index.js mtime: {stat.st_mtime}')

stat2 = sftp.stat(remote_base + '/src/agent/models.ts')
print(f'src/agent/models.ts size: {stat2.st_size} bytes')

sftp.close()
transport.close()
