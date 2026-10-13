; =============================================================================
; dsh-Love Guide —— 安装界面定制
;
; 两个插入点是 electron-builder 官方留的，都已核对过源码：
;   customWelcomePage          templates/nsis/assistedInstaller.nsh:9-11
;                              插在「选择安装模式」之前，也就是安装程序的第一个页面
;   customPageAfterChangeDir   templates/nsis/assistedInstaller.nsh:42-44
;                              插在「选择安装路径」之后、「开始安装」之前
; 两个宏必须在本文件里定义好。electron-builder 把这个文件拼在 installer.nsi 之前
; （NsisTarget.js:353 的 sharedHeader + script），而 installer.nsi 到第 9 行才
; !include "MUI2.nsh"，所以在本文件被解析时 MUI2 / nsDialogs / WinMessages 都还没进来，
; !insertmacro MUI_HEADER_TEXT 这类写法会直接报「macro not found」。
;
; 因此这里只用 nsDialogs 插件的原生命令，不依赖任何头文件；代价是窗口风格常量要自己写
; 数值。makensis 统一按 UTF-8 读源码（NsisTarget.js:515 传了 -INPUTCHARSET UTF8），
; 所以下面的中文不需要 BOM。
;
; 为什么图标和软件名是一整张图：NSIS 对控件字体和圆角的支持很差，用 nsDialogs 拼出来的
; 标题会很粗糙。改成把「圆角图标 + 软件名 + 副标题」用 PIL 合成成一张 400x120 的位图
; （build/make-installer-art.py），页面上只放一个 BITMAP 控件，设计全在 Python 里控制。
; =============================================================================

!ifndef GTJS_INSTALLER_NSH
!define GTJS_INSTALLER_NSH

; -----------------------------------------------------------------------------
; 下面这些函数只在编译「安装器」那一趟需要。
;
; electron-builder 会先用同一份 sharedHeader 编译一趟卸载器（那一趟 defines 里有
; BUILD_UNINSTALLER），而 assistedInstaller.nsh 里所有安装页都被 !ifndef BUILD_UNINSTALLER
; 包着，卸载器那趟一个页面都不会插入。如果这里仍然把 Function 定义出来，makensis 就会报
;
;   warning 6010: install function "GtjsWelcomeCreate" not referenced - zeroing code out
;
; 而 electron-builder 把警告当错误（Error: warning treated as error）直接判定构建失败。
; 所以函数体必须跟着那趟的定义一起被跳过。
;
; 两个 !macro 特意留在 guard 外面：宏体只有被 !insertmacro 展开时才解析，而卸载器那趟
; 不会展开它们，所以宏里引用的函数名即使不存在也没关系。
; -----------------------------------------------------------------------------
!ifndef BUILD_UNINSTALLER

; ---- 窗口风格常量（值取自 WinUser.h，不引头文件是为了避开上面说的顺序问题）----
!define GTJS_WS_CHILD          0x40000000
!define GTJS_WS_VISIBLE        0x10000000
!define GTJS_WS_TABSTOP        0x00010000
!define GTJS_WS_EX_CLIENTEDGE  0x00000200
!define GTJS_SS_LEFT           0x00000000
!define GTJS_SS_BITMAP         0x0000000E
!define GTJS_SS_REALSIZEIMAGE  0x00000800
!define GTJS_ES_AUTOHSCROLL    0x00000080
!define GTJS_ES_READONLY       0x00000800

!define GTJS_IMAGE_BITMAP      0
!define GTJS_LR_LOADFROMFILE   0x00000010
!define GTJS_STM_SETIMAGE      0x0172
!define GTJS_WM_SETTEXT        0x000C

!define GTJS_STATIC   "${GTJS_WS_CHILD}|${GTJS_WS_VISIBLE}"
!define GTJS_EDITBOX  "${GTJS_WS_CHILD}|${GTJS_WS_VISIBLE}|${GTJS_WS_TABSTOP}|${GTJS_ES_AUTOHSCROLL}|${GTJS_ES_READONLY}"
!define GTJS_BITMAPBOX "${GTJS_STATIC}|${GTJS_SS_BITMAP}|${GTJS_SS_REALSIZEIMAGE}"

; ---- 颜色（SetCtlColors 收的是 COLORREF，字节序是 BGR 不是 RGB）----
!define GTJS_BG     0x00F0F0F0   ; RGB(240,240,240)，与品牌图底色一致
!define GTJS_INK    0x001B1818   ; #18181B
!define GTJS_MUTED  0x007A7171   ; #71717A
!define GTJS_WHITE  0x00FFFFFF

; -----------------------------------------------------------------------------
; 在页面顶部贴品牌图。
;
; 图是 300x88 像素（build/make-installer-art.py 里的 brand_strip），控件给 226x66。
; 这两个数的关系不能随便改：nsDialogs 的控件坐标是对话单位（DLU），而 BITMAP 控件
; 是按图片的真实像素画的（SS_REALSIZEIMAGE），所以
;     控件 DLU 尺寸 = 图片像素尺寸 / 1.33
; 一旦控件比图片小，图片会溢出控件、压到下面的文字上。
; -----------------------------------------------------------------------------
Function GtjsBrandHeader
  Push $R0
  Push $R1

  InitPluginsDir
  File /oname=$PLUGINSDIR\gtjs-brand.bmp "${BUILD_RESOURCES_DIR}\installer-brand.bmp"

  nsDialogs::CreateControl STATIC "${GTJS_BITMAPBOX}" 0 37 2 226 66 ""
  Pop $R0
  System::Call 'user32::LoadImageW(i 0, w "$PLUGINSDIR\gtjs-brand.bmp", i ${GTJS_IMAGE_BITMAP}, i 0, i 0, i ${GTJS_LR_LOADFROMFILE}) p .R1'
  SendMessage $R0 ${GTJS_STM_SETIMAGE} ${GTJS_IMAGE_BITMAP} $R1

  Pop $R1
  Pop $R0
FunctionEnd

; 把「下一步」按钮上的字换掉，让这个页面在说什么更清楚。
; 新文案由调用方放在 $R1 里传进来（用完就被覆盖，调用方不需要它还在）。
Function GtjsRenameNextButton
  Push $0
  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${GTJS_WM_SETTEXT} 0 "STR:$R1"
  Pop $0
FunctionEnd

; -----------------------------------------------------------------------------
; 第 1 页：欢迎 + 说明这个程序不会把你的东西传出去
; -----------------------------------------------------------------------------
Function GtjsWelcomeCreate
  nsDialogs::Create 1018
  Pop $0
  StrCmp $0 "error" 0 +2
    Abort

  Call GtjsBrandHeader
  SetCtlColors $0 ${GTJS_INK} ${GTJS_BG}

  ; 说明文字：一「行」一个 STATIC 控件，而不是一个控件里塞 $\r$\n。
  ; 因为多行 STATIC 的行距只有约 12px，而汉字本身就占约 11px，行与行会贴在一起；
  ; 拆成独立控件后行距由 y 坐标决定（这里取 16 对话单位），读起来才不挤。
  StrCpy $R2 "关系决策助手，跑在你自己电脑上。"
  nsDialogs::CreateControl STATIC "${GTJS_STATIC}|${GTJS_SS_LEFT}" 0 8 72 284 12 "$R2"
  Pop $1
  SetCtlColors $1 ${GTJS_INK} ${GTJS_BG}

  StrCpy $R2 "· 不注册、不登录，没有服务器"
  nsDialogs::CreateControl STATIC "${GTJS_STATIC}|${GTJS_SS_LEFT}" 0 8 90 284 12 "$R2"
  Pop $1
  SetCtlColors $1 ${GTJS_MUTED} ${GTJS_BG}

  StrCpy $R2 "· 关系档案与聊天记录只存在本机"
  nsDialogs::CreateControl STATIC "${GTJS_STATIC}|${GTJS_SS_LEFT}" 0 8 106 284 12 "$R2"
  Pop $1
  SetCtlColors $1 ${GTJS_MUTED} ${GTJS_BG}

  StrCpy $R2 "· 模型 API Key 由你自己填"
  nsDialogs::CreateControl STATIC "${GTJS_STATIC}|${GTJS_SS_LEFT}" 0 8 122 284 12 "$R2"
  Pop $1
  SetCtlColors $1 ${GTJS_MUTED} ${GTJS_BG}

  StrCpy $R1 "继续"
  Call GtjsRenameNextButton

  nsDialogs::Show
FunctionEnd

; -----------------------------------------------------------------------------
; 第 2 页（选择安装路径之后）：把「装到哪」摆出来，并说明数据放在哪
; -----------------------------------------------------------------------------
Function GtjsConfirmCreate
  nsDialogs::Create 1018
  Pop $0
  StrCmp $0 "error" 0 +2
    Abort

  Call GtjsBrandHeader
  SetCtlColors $0 ${GTJS_INK} ${GTJS_BG}

  nsDialogs::CreateControl STATIC "${GTJS_STATIC}|${GTJS_SS_LEFT}" 0 8 58 284 9 "安装位置"
  Pop $1
  SetCtlColors $1 ${GTJS_MUTED} ${GTJS_BG}

  ; $INSTDIR 到这里还没加上程序子目录（installSection.nsh 的 instFilesPre 才加），
  ; 所以这里把真实落地路径拼全给用户看。
  StrCpy $R2 "$INSTDIR\${APP_FILENAME}"
  ; 高度给到 26：13 和 18 都试过，都会被裁掉下半行（EDIT 的文本行比同高 STATIC 更占地方）
  nsDialogs::CreateControl EDIT "${GTJS_EDITBOX}" ${GTJS_WS_EX_CLIENTEDGE} 8 66 284 26 "$R2"
  Pop $2
  SetCtlColors $2 ${GTJS_INK} ${GTJS_WHITE}

  ; 三行、各一个单行 STATIC，行距 16 对话单位。每行都要短于约 340px（约 284 对话单位），
  ; 超了会被单行 STATIC 直接裁掉尾巴而不是折行。
  StrCpy $R2 "程序装在这个目录里的 dsh-love-guide 文件夹。"
  nsDialogs::CreateControl STATIC "${GTJS_STATIC}|${GTJS_SS_LEFT}" 0 8 98 284 12 "$R2"
  Pop $3
  SetCtlColors $3 ${GTJS_MUTED} ${GTJS_BG}

  StrCpy $R2 "档案放在旁边的 dsh-love-guide-data\ 里。"
  nsDialogs::CreateControl STATIC "${GTJS_STATIC}|${GTJS_SS_LEFT}" 0 8 114 284 12 "$R2"
  Pop $3
  SetCtlColors $3 ${GTJS_MUTED} ${GTJS_BG}

  StrCpy $R2 "卸载程序不会删除它们。"
  nsDialogs::CreateControl STATIC "${GTJS_STATIC}|${GTJS_SS_LEFT}" 0 8 130 284 12 "$R2"
  Pop $3
  SetCtlColors $3 ${GTJS_MUTED} ${GTJS_BG}

  StrCpy $R1 "开始安装"
  Call GtjsRenameNextButton

  nsDialogs::Show
FunctionEnd

!endif ; BUILD_UNINSTALLER

!macro customWelcomePage
  Page custom GtjsWelcomeCreate
!macroend

!macro customPageAfterChangeDir
  Page custom GtjsConfirmCreate
!macroend

!endif ; GTJS_INSTALLER_NSH
