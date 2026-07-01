Set shell = CreateObject("WScript.Shell")
startupDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
projectDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(startupDir)
command = "cmd /c cd /d """ & projectDir & """ && node server.js"
shell.Run command, 0, False
