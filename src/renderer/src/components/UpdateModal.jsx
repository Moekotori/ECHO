import React, { useEffect, useState } from 'react'
import { Download, RefreshCw, X, CheckCircle, Package } from 'lucide-react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useTranslation } from 'react-i18next'

export default function UpdateModal({
  updateStatus,
  onClose,
  open
}) {
  const { t } = useTranslation()
  const [releaseNotesRaw, setReleaseNotesRaw] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  // Automatically fetch release notes specifically linked to this version or general latest
  useEffect(() => {
    if (open && updateStatus?.version && !releaseNotesRaw) {
      setIsLoading(true)
      fetch(`https://api.github.com/repos/Moekotori/Echoes/releases/tags/v${updateStatus.version}`)
        .then((res) => res.json())
        .then((data) => {
          if (data && data.body) {
            setReleaseNotesRaw(data.body)
          } else {
            setReleaseNotesRaw(t('updateModal.noNotesFound', '暂无详细更新日志。'))
          }
        })
        .catch(() => {
          setReleaseNotesRaw(t('updateModal.fetchFailed', '获取更新日志失败...'))
        })
        .finally(() => {
          setIsLoading(false)
        })
    }
  }, [open, updateStatus?.version, releaseNotesRaw, t])

  if (!open || !updateStatus) return null

  const isDownloaded = updateStatus.event === 'update-downloaded'
  const isDownloading = updateStatus.event === 'download-progress'
  const isAvailable = updateStatus.event === 'update-available'
  const percent = updateStatus.percent || 0
  const version = updateStatus.version || '?'

  const handleInstall = () => {
    window.api?.installUpdate?.()
  }

  const renderContent = () => {
    const defaultText = isDownloaded ? t('updateModal.readyToInstall', '新版本已下载完毕，安装后即可体验最新功能！') : t('updateModal.discovering', 'ECHO 有新的版本可用，正在为您下载中...')

    return (
      <div className="update-modal-body">
        {isLoading ? (
          <div className="update-modal-loader">
            <RefreshCw className="spin" size={18} /> {t('updateModal.loadingNotes', '正在获取更新日志...')}
          </div>
        ) : (
          <div
            className="markdown-body"
            dangerouslySetInnerHTML={{
              __html: DOMPurify.sanitize(marked(releaseNotesRaw || defaultText))
            }}
          />
        )}
      </div>
    )
  }

  return (
    <div className="update-modal-overlay">
      <div className="update-modal-container">
        <div className="update-modal-header">
          <div className="update-modal-title">
            <Package size={20} strokeWidth={2} />
            <span>{t('updateModal.title', '发现新版本')} v{version}</span>
          </div>
          {isDownloaded && (
            <button className="update-modal-close" onClick={onClose} title={t('common.close', '关闭')}>
              <X size={20} strokeWidth={2.5} />
            </button>
          )}
        </div>

        {renderContent()}

        <div className="update-modal-footer">
          {isDownloading || isAvailable ? (
            <div className="update-modal-progress-wrapper">
              <div className="update-modal-progress-label">
                <Download size={14} /> 
                {isDownloading ? `${t('updateModal.downloading', '正在下载')}... ${percent}%` : t('updateModal.startingDownload', '准备下载中...')}
              </div>
              <div className="update-modal-progress-bar">
                <div 
                  className="update-modal-progress-fill" 
                  style={{ width: `${Math.max(percent, 2)}%` }} 
                />
              </div>
            </div>
          ) : isDownloaded ? (
            <div className="update-modal-actions">
              <button className="update-modal-btn-secondary" onClick={onClose}>
                {t('updateModal.installLater', '稍后安装')}
              </button>
              <button className="update-modal-btn-primary" onClick={handleInstall}>
                <CheckCircle size={16} />
                {t('updateModal.installNow', '重启并安装')}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
