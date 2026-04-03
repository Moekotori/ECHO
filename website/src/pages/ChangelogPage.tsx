import useSWR from 'swr'
import { motion } from 'framer-motion'
import { loadChangelog, type ChangelogEntry } from '../lib/content'

export function ChangelogPage() {
  const { data: items, error } = useSWR<ChangelogEntry[]>('changelog', loadChangelog, {
    revalidateOnFocus: false,
  })

  const err = error?.message || (error ? '无法加载更新日志，请稍后重试。' : '')

  return (
    <motion.div 
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-8 relative"
    >
      <div className="aurora-bg"></div>

      <div className="relative z-10 flex flex-col items-center py-6 text-center">
        <span className="mb-3 rounded-full bg-blue-100/60 px-3 py-1 text-xs font-bold text-blue-600 shadow-sm border border-blue-200/50">
          Changelog
        </span>
        <h1 className="text-4xl font-black tracking-tight text-slate-900 sm:text-5xl">更新日志</h1>
        <p className="mt-4 max-w-lg text-base font-medium text-slate-600">
          新功能、体验优化与问题修复，按版本汇总如下。
        </p>
      </div>

      <section className="echo-card p-6 sm:p-10 relative z-10 bg-white/70 backdrop-blur-xl border-white/50 shadow-xl overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-pink-400/10 blur-3xl rounded-full"></div>
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-blue-400/10 blur-3xl rounded-full"></div>

        {!items && !err && (
          <div className="flex flex-col gap-6 animate-pulse relative z-10">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 bg-slate-200/50 rounded-2xl w-full border border-slate-200/30"></div>
            ))}
          </div>
        )}
        
        {err && (
          <div className="flex flex-col items-center justify-center py-10 text-center gap-3 text-red-500 relative z-10">
            <div className="w-12 h-12 flex items-center justify-center bg-red-100 rounded-full border border-red-200 text-2xl font-bold">!</div>
            <div className="font-bold text-lg">加载失败</div>
            <div className="text-sm font-medium">{err}</div>
          </div>
        )}

        {items && (
          <div className="flex flex-col gap-6 relative z-10">
            {items.map((it, i) => (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1, duration: 0.4 }}
                key={it.version}
                className="relative rounded-3xl border border-white/60 bg-white/60 p-6 shadow-sm hover:shadow-md transition-shadow backdrop-blur-sm"
              >
                <div className="absolute top-0 right-0 -mr-px -mt-px w-20 h-20 overflow-hidden outline-none pointer-events-none rounded-tr-3xl">
                   {i === 0 && <div className="absolute top-0 right-0 bg-gradient-to-l from-emerald-400 to-emerald-300 shadow shadow-emerald-400/50 text-[10px] font-bold text-white text-center py-1 right-[-35px] top-[15px] w-[120px] transform rotate-45 z-10">LATEST</div>}
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between border-b border-slate-100 pb-4 mb-4">
                  <div className="flex items-center gap-3">
                    <div className="text-2xl font-black tracking-tight text-slate-800">
                      <span className="text-pink-500/50">v</span>{it.version}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-slate-300"></div>
                    <div className="text-sm font-bold text-slate-500">{it.date}</div>
                  </div>
                </div>
                
                <ul className="space-y-3">
                  {it.items.map((s, idx) => (
                    <li key={idx} className="flex gap-4 text-[15px] font-medium text-slate-700 leading-relaxed">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400 drop-shadow-[0_0_4px_rgba(96,165,250,0.8)]"></span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </motion.div>
            ))}
          </div>
        )}
      </section>
    </motion.div>
  )
}

