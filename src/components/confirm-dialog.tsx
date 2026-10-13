import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog'
import { useStudio } from '#/lib/store'

/**
 * 全局唯一的一个确认框，由 store.askConfirm() 驱动。
 *
 * 这样写而不是给每处删改都塞一个 <AlertDialog>，是因为「问一句再动手」出现在
 * 侧栏、对话页、聊天记录页、设置页里，各处自己维护 open 状态很容易漏掉点击外部关闭
 * 或者重复触发；集中一处，行为就永远一致。
 */
export function ConfirmDialog() {
  const req = useStudio((s) => s.confirmRequest)
  const answer = useStudio((s) => s.answerConfirm)

  return (
    <AlertDialog open={Boolean(req)} onOpenChange={(v) => !v && answer(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{req?.title ?? ''}</AlertDialogTitle>
          {req?.body && (
            <AlertDialogDescription className="whitespace-pre-wrap">{req.body}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => answer(false)}>取消</AlertDialogCancel>
          <AlertDialogAction
            variant={req?.destructive ? 'destructive' : 'default'}
            onClick={() => answer(true)}
          >
            {req?.confirmLabel ?? '确认'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
