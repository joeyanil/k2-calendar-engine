export async function onRequestError(err: unknown) {
  const e = err as Error & { digest?: string }
  console.error(
    '[REAL ERROR] name=' + e?.name +
    ' message=' + e?.message +
    ' digest=' + e?.digest +
    ' stack=' + e?.stack
  )
}
