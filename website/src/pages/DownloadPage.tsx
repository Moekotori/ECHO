import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { motion } from 'framer-motion'
import confetti from 'canvas-confetti'
import { formatBytes, loadReleases, type ReleasesContent } from '../lib/content'
import { Download, Copy, CheckCircle2 } from 'lucide-react'
import toast from 'react-hot-toast'

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <motion.button
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      type="button"
      className={`echo-btn px-3 py-2 text-xs border border-slate-200/60 shadow-sm ${copied ? 'text-emerald-500 bg-emerald-50' : 'text-slate-600 bg-white hover:bg-slate-50'}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          toast.success('已复制到剪贴板')
          window.setTimeout(() => setCopied(false), 1500)
        } catch {
          toast.error('复制失败，请手动选择复制')
        }
      }}
    >
      {copied ? <CheckCircle2 size={14} className="stroke-[2.5]" /> : <Copy size={14} />}
      {copied ? '已复制' : '复制'}
    </motion.button>
  )
}

export function DownloadPage() {
  const { data, error } = useSWR<ReleasesContent>('releases', loadReleases, {
    revalidateOnFocus: false,
  })
  
  const err = error?.message || (error ? '无法加载版本信息，请稍后重试。' : '')

  const primary = useMemo(() => {
    const files = data?.files || []
    return files.find((f) => /\.exe$/i.test(f.name)) || files[0] || null
  }, [data])

  return (
    <motion.div 
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-6"
    >
      <div>
        <h1 className="text-2xl font-black tracking-tight text-black">下载</h1>
        <p className="mt-2 text-sm text-black/60">
          请从下方获取适用于 Windows 的安装包。若需核对文件是否完整，可复制 SHA256 与本地校验结果比对。
        </p>
      </div>

      <section className="echo-card p-6 sm:p-8 bg-white/70 backdrop-blur-xl border-white/50 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-pink-400 via-blue-400 to-emerald-400 opacity-50"></div>
        
        {!data && !err && (
          <div className="flex flex-col gap-4 animate-pulse">
            <div className="h-20 bg-slate-200/50 rounded-2xl w-full"></div>
            <div className="h-32 bg-slate-200/50 rounded-2xl w-full"></div>
            <div className="h-32 bg-slate-200/50 rounded-2xl w-full"></div>
          </div>
        )}
        {err && (
          <div className="flex flex-col items-center justify-center py-10 text-center gap-3 text-red-500">
            <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center border-4 border-red-50 text-2xl">!</div>
            <div className="font-bold">版本信息加载失败</div>
            <div className="text-sm font-medium text-slate-500">{err}</div>
          </div>
        )}

        {data && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex flex-col gap-1">
                <div className="text-xs font-extrabold uppercase tracking-wide text-black/45">
                  Latest
                </div>
                <div className="text-xl font-black tracking-tight text-black">ECHO {data.version}</div>
                <div className="text-xs font-semibold text-black/45">
                  发布于 {data.publishedAt}
                </div>
              </div>
              {primary && (
                <a 
                  className="echo-btn echo-btn-primary w-full sm:w-auto" 
                  href={primary.path}
                  onClick={() => {
                    confetti({
                      particleCount: 150,
                      spread: 70,
                      origin: { y: 0.8 },
                      colors: ['#38bdf8', '#34d399', '#f472b6']
                    });
                    toast.success('正在为您下载ECHO，请稍候！', { icon: '✨' });
                  }}
                >
                  <Download size={16} /> 下载 {primary.name}
                </a>
              )}
            </div>

            <div className="grid gap-3">
              {data.files.map((f) => (
                <div
                  key={f.path}
                  className="rounded-2xl border border-black/10 bg-[color:var(--echo-surface-2)] p-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-extrabold text-black">{f.name}</div>
                      <div className="mt-1 text-xs font-semibold text-black/50">
                        {formatBytes(f.bytes)} ·{' '}
                        <a href={f.path} className="text-black/70">
                          {f.path}
                        </a>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <motion.a
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        className="echo-btn px-4 py-2 text-xs bg-slate-900 text-white hover:bg-slate-800 border-transparent shadow-md"
                        href={f.path}
                        onClick={() => {
                          confetti({
                            particleCount: 150,
                            spread: 70,
                            origin: { y: 0.8 },
                            colors: ['#38bdf8', '#34d399', '#f472b6']
                          });
                          toast.success('正在为您下载ECHO，请稍候！', { icon: '✨' });
                        }}
                      >
                        <Download size={14} />下载
                      </motion.a>
                      <CopyButton value={f.path} />
                    </div>
                  </div>

                  <div className="mt-3 flex flex-col gap-2">
                    <div className="text-xs font-extrabold uppercase tracking-wide text-black/45">
                      SHA256
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <code className="overflow-x-auto rounded-xl border border-black/10 bg-white px-3 py-2 text-xs font-semibold text-black/75">
                        {f.sha256}
                      </code>
                      <CopyButton value={f.sha256} />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-black/10 bg-white/70 p-4 text-sm text-black/60">
              <div className="font-extrabold text-black">校验示例（PowerShell）</div>
              <div className="mt-2 flex flex-col gap-2">
                <code className="rounded-xl border border-black/10 bg-white px-3 py-2 text-xs font-semibold text-black/75">
                  Get-FileHash \"{data.files[0]?.name || 'ECHO Setup.exe'}\" -Algorithm SHA256
                </code>
              </div>
            </div>
          </div>
        )}
      </section>
    </motion.div>
  )
}

