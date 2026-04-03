import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'

export function HomePage() {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.4 }}
      className="flex flex-col gap-10"
    >
      <section className="echo-card overflow-hidden">
        <div className="grid gap-8 p-7 sm:grid-cols-2 sm:items-center sm:p-10">
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="echo-chip">清爽浅色</span>
              <span className="echo-chip">强可读</span>
              <span className="echo-chip">HiFi / 独占</span>
            </div>
            <h1 className="text-3xl font-black tracking-tight text-black sm:text-4xl">
              ECHO，让你的本地音乐更好听、更顺手
            </h1>
            <p className="text-base leading-relaxed text-black/65">
              一款桌面音乐播放器：HiFi 引擎（原生输出）、WASAPI 独占、输出设备选择、EQ、歌词与 MV，
              以及可扩展插件。设计克制、信息清晰。
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link to="/download" className="echo-btn echo-btn-primary">
                下载 Windows 版
              </Link>
              <Link to="/changelog" className="echo-btn">
                查看更新日志
              </Link>
            </div>
            <p className="text-xs font-semibold text-black/45">
              在下载页可核对安装包大小与校验值，安心安装。
            </p>
          </div>

          <div className="relative">
            <div className="absolute -right-10 -top-10 h-44 w-44 rounded-full bg-pink-300/20 blur-2xl" />
            <div className="absolute -bottom-10 -left-10 h-44 w-44 rounded-full bg-sky-300/20 blur-2xl" />
            <div className="relative grid gap-3 rounded-[28px] border border-black/10 bg-white p-4 shadow-sm">
              <div className="text-xs font-extrabold tracking-wide text-black/55">界面预览</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="aspect-[4/3] relative overflow-hidden rounded-2xl border border-black/10 bg-slate-100/60">
                  <img
                    src="/images/1.png"
                    alt="ECHO screenshot 1"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                </div>
                <div className="aspect-[4/3] relative overflow-hidden rounded-2xl border border-black/10 bg-slate-100/60">
                  <img
                    src="/images/2.png"
                    alt="ECHO screenshot 2"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                </div>
                <div className="col-span-2 aspect-[16/9] relative overflow-hidden rounded-2xl border border-black/10 bg-slate-100/60">
                  <img
                    src="/images/3.png"
                    alt="ECHO screenshot 3"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="echo-card p-6">
          <div className="text-sm font-extrabold text-black">清晰界面</div>
          <div className="mt-2 text-sm leading-relaxed text-black/60">
            播放、列表与设置分区清楚，常用操作几步就到，减少找功能的时间。
          </div>
        </div>
        <div className="echo-card p-6">
          <div className="text-sm font-extrabold text-black">安全下载</div>
          <div className="mt-2 text-sm leading-relaxed text-black/60">
            下载页提供安装包体积与 SHA256，便于核对文件是否完整、未被篡改。
          </div>
        </div>
        <div className="echo-card p-6">
          <div className="text-sm font-extrabold text-black">歌词 · MV · 插件</div>
          <div className="mt-2 text-sm leading-relaxed text-black/60">
            支持歌词与 MV 播放体验优化，并提供可扩展插件入口，按你的习惯慢慢加功能。
          </div>
        </div>
      </section>
    </motion.div>
  )
}

