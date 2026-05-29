Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = "C:\Users\Musty\OneDrive\Desktop\amara"
shell.Environment("PROCESS")("PORT") = "3000"
shell.Run """C:\Program Files\nodejs\node.exe"" server.js", 0, False
