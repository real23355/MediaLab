Unicode true
!include "FileFunc.nsh"
!include "LogicLib.nsh"
Name "MediaLab ${VERSION}"
OutFile "${OUTPUT}"
RequestExecutionLevel user
SetCompressor zlib
SetCompress auto
CRCCheck on
AutoCloseWindow true
ShowInstDetails nevershow
Caption "MediaLab - Preparing first launch"
InstallDir "$LOCALAPPDATA\MediaLab\runtime\${CACHE_KEY}"
Icon "${ICON}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "MediaLab"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "FileDescription" "MediaLab portable launcher"
VIAddVersionKey "LegalCopyright" "MediaLab contributors"
Page instfiles
Var LockHandle
Function .onInit
  SetShellVarContext current
  StrCpy $INSTDIR "$LOCALAPPDATA\MediaLab\runtime\${CACHE_KEY}"
  IfFileExists "$INSTDIR\.ready" 0 first
  IfFileExists "$INSTDIR\MediaLab.exe" 0 first
  IfFileExists "$INSTDIR\resources\app.asar" 0 first
  IfFileExists "$INSTDIR\resources\ffmpeg\ffmpeg.exe" 0 first
  IfFileExists "$INSTDIR\resources\ffmpeg\ffprobe.exe" 0 first
  SetSilent silent
  first:
FunctionEnd
Section
  System::Call 'kernel32::CreateMutexW(p 0, i 0, w "Local\MediaLab-runtime-${CACHE_KEY}") p .r0'
  StrCpy $LockHandle $0
  System::Call 'kernel32::WaitForSingleObject(p r0, i -1) i .r1'
  IfFileExists "$INSTDIR\.ready" 0 extract
  IfFileExists "$INSTDIR\MediaLab.exe" 0 extract
  IfFileExists "$INSTDIR\resources\app.asar" 0 extract
  IfFileExists "$INSTDIR\resources\ffmpeg\ffmpeg.exe" 0 extract
  IfFileExists "$INSTDIR\resources\ffmpeg\ffprobe.exe" launch extract
  extract:
  DetailPrint "Preparing MediaLab runtime (first launch only)..."
  SetOutPath "$INSTDIR"
  ClearErrors
  File /r "${PAYLOAD}\*.*"
  IfErrors failed
  FileOpen $0 "$INSTDIR\.ready" w
  FileWrite $0 "${CACHE_KEY}"
  FileClose $0
  launch:
  StrCpy $0 $LockHandle
  System::Call 'kernel32::ReleaseMutex(p r0)'
  System::Call 'kernel32::CloseHandle(p r0)'
  ${GetParameters} $1
  System::Call 'kernel32::SetEnvironmentVariableW(w "PORTABLE_EXECUTABLE_FILE", w "$EXEPATH")'
  System::Call 'kernel32::SetEnvironmentVariableW(w "PORTABLE_EXECUTABLE_DIR", w "$EXEDIR")'
  Exec '"$INSTDIR\MediaLab.exe" $1'
  IfErrors failed
  Goto done
  failed:
  MessageBox MB_OK|MB_ICONSTOP "MediaLab could not prepare or start. Check available disk space and try again."
  SetErrorLevel 1
  done:
SectionEnd
