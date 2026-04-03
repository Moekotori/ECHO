import { motion } from 'framer-motion'

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: 'ECHO 支持哪些系统？',
    a: '当前官网提供 Windows 安装包。请使用较新的 Windows 10 / 11 64 位系统，并保持声卡与 USB 音频驱动为厂商最新版本。'
  },
  {
    q: '如何安装与卸载？',
    a: '下载安装包后双击按向导安装即可。卸载可在「设置 → 应用」中找到 ECHO 卸载，或使用安装目录自带的卸载程序（若有）。'
  },
  {
    q: '安装后没有声音怎么办？',
    a: '先确认系统音量与 ECHO 内音量未被静音；在音频设置中选择正确的输出设备；若使用 HiFi/独占模式，请确认该模式下设备未被其他程序占用。仍无声可尝试重启应用或切换一次输出设备。'
  },
  {
    q: '下载后如何确认安装包没被损坏？',
    a: '在下载页复制对应文件的 SHA256，在 PowerShell 中对已下载文件执行 Get-FileHash（算法选 SHA256），与页面展示一致即可。'
  },
  {
    q: 'WASAPI 独占模式是什么？为什么开了之后别的软件没声音？',
    a: '独占模式会绕过系统混音并占用声卡设备，通常可获得更稳定、更少重采样的输出，但期间其他应用可能无法同时使用同一设备出声。需要多软件同时播放时，请关闭独占或改用系统默认共享输出。'
  },
  {
    q: '播放时出现爆音、卡顿或断续？',
    a: '可在音频设置中提高缓冲（例如选择更偏稳定的缓冲档位）；检查 CPU 占用与 USB 线材/供电；独占模式下对驱动与硬件更敏感，可尝试更新声卡驱动或暂时切回共享模式排查。'
  },
  {
    q: '界面里显示的采样率和文件不一致？',
    a: '在系统共享输出时可能经过混音与重采样；独占模式会尽量按源采样率输出。部分 DAC 或驱动会固定显示某一采样率，也可能与文件标注不同，以实际听感与设备能力为准。'
  },
  {
    q: 'DSD 文件怎么播？',
    a: '当前版本会将 DSD 转为高采样率 PCM 播放以保证兼容性。若未来支持 DoP（DSD over PCM），会在支持的设备上提供对应选项。'
  },
  {
    q: 'HiFi 模式下 EQ 不生效？',
    a: '请确认已在 EQ 相关设置中开启处理；不同输出路径下信号链可能不同。若某项功能在特定模式下不可用，以软件内说明为准。'
  },
  {
    q: '歌词对不上或逐字高亮不准？',
    a: '可尝试重新匹配歌词或手动选择更合适的来源；在歌词设置中可微调时间偏移，或关闭逐字高亮以减少观感上的「错位感」。'
  },
  {
    q: 'MV 画面卡顿、暂停时视频不停？',
    a: 'ECHO 会尽量让 MV 与播放进度一致。若个别在线源本身存在延迟或缓冲问题，可尝试切换清晰度或重新打开 MV；暂停时请确认播放状态与 MV 面板一致。'
  },
  {
    q: '波形或频谱不动？',
    a: '可视化依赖当前播放链路提供的分析数据。若使用原生/独占等路径，请以软件内实际表现为准；可尝试切换输出模式或重启播放后查看。'
  },
  {
    q: '如何添加本地音乐？',
    a: '使用播放列表或导入功能将本地文件夹/文件加入库（具体入口以软件界面为准）。建议音乐文件路径尽量不含异常字符，并放在固定磁盘位置。'
  },
  {
    q: '插件在哪里管理？',
    a: '在应用内打开插件管理相关入口即可启用或禁用插件。只安装来源可靠的插件，以免影响稳定性与隐私。'
  },
  {
    q: '软件崩溃或异常退出怎么办？',
    a: '若开启了崩溃报告，可按提示上传或保存日志便于排查。你也可以尝试删除缓存、更新到最新版本，或在干净环境下重装。'
  },
  {
    q: '如何获取新版本？',
    a: '关注本站的下载页与更新日志。安装新版本前建议关闭正在运行的 ECHO，并备份播放列表或配置文件（若你自行修改过）。'
  }
]

export function FaqPage() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-6"
    >
      <div>
        <h1 className="text-2xl font-black tracking-tight text-black">常见问题</h1>
        <p className="mt-2 text-sm text-black/60">
          下面是使用 ECHO 时较常遇到的问题与处理思路；若仍无法解决，建议更新到最新版本后重试。
        </p>
      </div>

      <section className="echo-card p-6 sm:p-8">
        <div className="grid gap-3">
          {FAQ.map((x) => (
            <details
              key={x.q}
              className="rounded-2xl border border-black/10 bg-[color:var(--echo-surface-2)] p-4"
            >
              <summary className="cursor-pointer list-none text-sm font-extrabold text-black">
                {x.q}
              </summary>
              <div className="mt-2 text-sm leading-relaxed text-black/70">{x.a}</div>
            </details>
          ))}
        </div>
      </section>
    </motion.div>
  )
}
