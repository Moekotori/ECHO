import { NavLink, useLocation } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { Globe, ChevronDown, Moon, Sun } from "lucide-react"
import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "../lib/utils"

function ThemeToggle() {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"))

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add("dark")
    } else {
      document.documentElement.classList.remove("dark")
    }
  }, [isDark])

  return (
    <button
      onClick={() => setIsDark(!isDark)}
      className="grid h-8 w-8 place-items-center rounded-full bg-slate-100/80 dark:bg-zinc-800/80 text-slate-700 dark:text-zinc-300 hover:bg-slate-200/80 dark:hover:bg-zinc-700/80 transition-colors ml-1"
      aria-label="Toggle theme"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={isDark ? "dark" : "light"}
          initial={{ opacity: 0, scale: 0.5, rotate: -45 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          exit={{ opacity: 0, scale: 0.5, rotate: 45 }}
          transition={{ duration: 0.15 }}
        >
          {isDark ? <Moon size={15} /> : <Sun size={15} />}
        </motion.div>
      </AnimatePresence>
    </button>
  )
}

function LanguageSwitcher() {
  const { i18n } = useTranslation()
  const [open, setOpen] = useState(false)

  const langs = [
    { code: "zh", name: "简体中文" },
    { code: "en", name: "English" },
    { code: "ja", name: "日本語" },
    { code: "ko", name: "한국어" }
  ]

  const currentLang = langs.find(l => l.code === i18n.language) || langs[0]

  return (
    <div
      className="relative ml-1 sm:ml-2"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button className="flex h-8 items-center gap-1.5 rounded-full bg-slate-100/80 dark:bg-zinc-800/80 hover:bg-slate-200/80 dark:hover:bg-zinc-700/80 px-3 text-xs font-bold text-slate-700 dark:text-zinc-300 transition-colors">
        <Globe size={14} />
        <span className="hidden sm:inline">{currentLang.name}</span>
        <ChevronDown size={12} className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full pt-2"
          >
            <div className="flex w-32 flex-col rounded-2xl bg-white dark:bg-zinc-900 border border-slate-200/50 dark:border-zinc-800 p-1.5 shadow-xl overflow-hidden">
              {langs.map((l) => (
                <button
                  key={l.code}
                  onClick={() => {
                    i18n.changeLanguage(l.code)
                    setOpen(false)
                  }}
                  className={cn(
                    "rounded-xl px-3 py-2 text-left text-xs font-bold transition-colors",
                    i18n.language === l.code
                      ? "bg-slate-100 dark:bg-zinc-800 text-slate-900 dark:text-zinc-100"
                      : "text-slate-500 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-800/50 hover:text-slate-900 dark:hover:text-zinc-100"
                  )}
                >
                  {l.name}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function TopNav() {
  const { t } = useTranslation()
  const location = useLocation()

  const navLinks = [
    { path: "/", label: t("nav.home"), exact: true },
    { path: "/download", label: t("nav.download") },
    { path: "/changelog", label: t("nav.changelog") },
    { path: "/faq", label: t("nav.faq") },
  ]

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/50 dark:border-zinc-800/50 bg-white/60 dark:bg-[#09090b]/60 backdrop-blur-2xl transition-colors">
      <div className="echo-container flex h-16 items-center justify-between gap-2 sm:gap-4">
        <NavLink to="/" className="flex items-center gap-3 transition-transform hover:scale-[1.02] active:scale-[0.98] outline-none rounded-xl focus-visible:ring-2 focus-visible:ring-slate-900/20 dark:focus-visible:ring-zinc-100/20">
          <div className="grid h-9 w-9 place-items-center rounded-[10px] bg-slate-900 dark:bg-white text-white dark:text-zinc-900 shadow-[0_2px_10px_rgba(0,0,0,0.1)] transition-colors">
            <span className="text-sm font-black tracking-tight">E</span>
          </div>
          <div className="leading-tight hidden md:block">
            <div className="text-sm font-extrabold tracking-tight text-slate-900 dark:text-zinc-100 transition-colors">ECHO</div>
            <div className="text-[10px] font-bold text-slate-500 dark:text-zinc-500 uppercase tracking-wider transition-colors">Music Player</div>
          </div>
        </NavLink>

        <nav className="flex items-center gap-0.5 sm:gap-1">
          {navLinks.map((link) => {
            const isActive = link.exact ? location.pathname === link.path : location.pathname.startsWith(link.path)
            return (
              <NavLink
                key={link.path}
                to={link.path}
                className="relative rounded-xl px-2.5 sm:px-3 py-2 text-[13px] sm:text-sm font-bold transition-colors focus:outline-none z-10"
              >
                <span className={cn(
                  "relative z-10 transition-colors duration-200", 
                  isActive ? "text-slate-900 dark:text-zinc-100" : "text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-300"
                )}>
                  {link.label}
                </span>
                {isActive && (
                  <motion.div
                    layoutId="nav-bg"
                    className="absolute inset-0 rounded-xl bg-slate-100 dark:bg-zinc-800 -z-0"
                    transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                  />
                )}
              </NavLink>
            )
          })}

          <div className="mx-1 h-4 w-px bg-slate-200 dark:bg-zinc-800 hidden sm:block" />
          <LanguageSwitcher />
          <ThemeToggle />
        </nav>
      </div>
    </header>
  )
}

export function SiteLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="min-h-dvh flex flex-col selection:bg-slate-200 dark:selection:bg-zinc-800 selection:text-slate-900 dark:selection:text-zinc-100 bg-transparent transition-colors">
      <TopNav />
      <main className="flex-1 pb-24 pt-8 sm:pt-12">
        <div className="echo-container">{children}</div>
      </main>
      <footer className="border-t border-slate-200/60 dark:border-zinc-800/60 bg-transparent transition-colors">
        <div className="echo-container flex flex-col gap-4 py-8 text-sm text-slate-500 dark:text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
          <span className="font-bold tracking-tight">© {new Date().getFullYear()} ECHO. All rights reserved.</span>
          <span className="flex flex-wrap items-center gap-2">
            <span className="echo-chip">{t("footer.tag1")}</span>
            <span className="echo-chip">{t("footer.tag2")}</span>
          </span>
        </div>
      </footer>
    </div>
  )
}
