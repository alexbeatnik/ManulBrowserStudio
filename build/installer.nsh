; What the installer adds to electron-builder's own script: a page that asks
; whether the demo project is wanted.
;
; The installer does not copy the project anywhere. Its hunts have to be given
; the address of the folder they end up in, and that folder is the documents
; of whoever starts the app, who need not be whoever installed it. So the
; answer is left as a file beside the app (resources\demo-project), and the
; app, on its next start, makes the copy and opens it (src/main/demo.ts).

!ifndef BUILD_UNINSTALLER
  !include nsDialogs.nsh
  !include FileFunc.nsh

  Var demoCheckbox
  Var demoWanted

  ; Yes unless the page says otherwise: a silent install shows no page.
  !macro customInit
    StrCpy $demoWanted ${BST_CHECKED}
  !macroend

  ; The functions are defined here and not at the top of this file, which is
  ; read before the installer's own definitions (isUpdated, the MUI macros).
  !macro customPageAfterChangeDir
    Page custom demoPageShow demoPageLeave

    Function demoPageShow
      ; An update is not a first installation: nothing to ask.
      ${if} ${isUpdated}
        Abort
      ${endif}
      !insertmacro MUI_HEADER_TEXT "Demo project" "A project to try ${PRODUCT_NAME} on."
      nsDialogs::Create 1018
      Pop $0
      ${NSD_CreateLabel} 0 0 100% 76u "The demo project is a small shop and four hunts written for it: plain steps, a hunt with a bug to find, page objects, a hook script and custom controls. It needs no network and nothing else installed.$\r$\n$\r$\nIt is put in Documents\Manul Browser Demo and opened when ${PRODUCT_NAME} first starts. Without it, the same project is one click away: File > Open Demo Project."
      Pop $0
      ${NSD_CreateCheckbox} 0 84u 100% 12u "Install the demo project"
      Pop $demoCheckbox
      ${NSD_SetState} $demoCheckbox $demoWanted
      nsDialogs::Show
    FunctionEnd

    Function demoPageLeave
      ${NSD_GetState} $demoCheckbox $demoWanted
    FunctionEnd
  !macroend

  ; The file says when the answer was given, so that the app can tell a new
  ; yes from the one it has already acted on: installing again brings back a
  ; demo project that was deleted, and starting again does not.
  !macro customInstall
    ${if} $demoWanted == ${BST_CHECKED}
      ${GetTime} "" "L" $0 $1 $2 $3 $4 $5 $6
      FileOpen $7 "$INSTDIR\resources\demo-project" w
      FileWrite $7 "$2-$1-$0 $4:$5:$6"
      FileClose $7
    ${else}
      Delete "$INSTDIR\resources\demo-project"
    ${endif}
  !macroend
!endif
