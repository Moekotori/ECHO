export type Locale = 'zh-CN' | 'zh-TW' | 'ja-JP' | 'en-US';

export const localeOptions: Array<{ locale: Locale; label: string }> = [
  { locale: 'zh-CN', label: '简体中文' },
  { locale: 'zh-TW', label: '繁體中文' },
  { locale: 'ja-JP', label: '日本語' },
  { locale: 'en-US', label: 'English' },
];

type AlbumDetailTranslationKey =
  | 'albumDetail.action.addToQueue'
  | 'albumDetail.action.back'
  | 'albumDetail.action.likeAlbum'
  | 'albumDetail.action.more'
  | 'albumDetail.action.openSource'
  | 'albumDetail.action.playNow'
  | 'albumDetail.action.readingAlbum'
  | 'albumDetail.action.refresh'
  | 'albumDetail.action.showInFolder'
  | 'albumDetail.action.unlikeAlbum'
  | 'albumDetail.aria.details'
  | 'albumDetail.aria.info'
  | 'albumDetail.aria.metadata'
  | 'albumDetail.aria.openArtist'
  | 'albumDetail.aria.sections'
  | 'albumDetail.aria.trackConsole'
  | 'albumDetail.artist.notFound'
  | 'albumDetail.count.albums'
  | 'albumDetail.count.loadedAlbums'
  | 'albumDetail.count.loadedTracks'
  | 'albumDetail.count.tracks'
  | 'albumDetail.credit.role.arrangement'
  | 'albumDetail.credit.role.composer'
  | 'albumDetail.credit.role.engineering'
  | 'albumDetail.credit.role.label'
  | 'albumDetail.credit.role.lyrics'
  | 'albumDetail.credit.role.other'
  | 'albumDetail.credit.role.performer'
  | 'albumDetail.credit.role.production'
  | 'albumDetail.credit.role.vocal'
  | 'albumDetail.credit.source.album'
  | 'albumDetail.credit.source.label'
  | 'albumDetail.credit.source.recording'
  | 'albumDetail.credit.source.work'
  | 'albumDetail.credit.summary.arrangement'
  | 'albumDetail.credit.summary.composer'
  | 'albumDetail.credit.summary.engineering'
  | 'albumDetail.credit.summary.label'
  | 'albumDetail.credit.summary.lyrics'
  | 'albumDetail.credit.summary.other'
  | 'albumDetail.credit.summary.performer'
  | 'albumDetail.credit.summary.production'
  | 'albumDetail.credit.summary.vocal'
  | 'albumDetail.credits.count'
  | 'albumDetail.credits.entries'
  | 'albumDetail.credits.heading'
  | 'albumDetail.credits.overviewAria'
  | 'albumDetail.credits.trackPrefix'
  | 'albumDetail.duration.hours'
  | 'albumDetail.duration.minutes'
  | 'albumDetail.fact.format'
  | 'albumDetail.fact.genre'
  | 'albumDetail.fact.library'
  | 'albumDetail.fact.released'
  | 'albumDetail.information.albumProfile'
  | 'albumDetail.information.artistProfile'
  | 'albumDetail.information.atGlance'
  | 'albumDetail.information.externalLinks'
  | 'albumDetail.information.overviewAria'
  | 'albumDetail.label.album'
  | 'albumDetail.online.emptyDescription'
  | 'albumDetail.online.emptyTitle'
  | 'albumDetail.online.match'
  | 'albumDetail.online.noSource'
  | 'albumDetail.online.possibleMatch'
  | 'albumDetail.online.reading'
  | 'albumDetail.online.sources'
  | 'albumDetail.online.unavailable'
  | 'albumDetail.ratings.count'
  | 'albumDetail.ratings.overviewAria'
  | 'albumDetail.releases.count'
  | 'albumDetail.releases.current'
  | 'albumDetail.releases.currentHint'
  | 'albumDetail.releases.heading'
  | 'albumDetail.releases.overviewAria'
  | 'albumDetail.related.aria'
  | 'albumDetail.related.heading'
  | 'albumDetail.related.loading'
  | 'albumDetail.related.thisAlbum'
  | 'albumDetail.sources.barcode'
  | 'albumDetail.sources.catalogNumber'
  | 'albumDetail.sources.copyright'
  | 'albumDetail.sources.kind.database'
  | 'albumDetail.sources.kind.official'
  | 'albumDetail.sources.kind.other'
  | 'albumDetail.sources.kind.reference'
  | 'albumDetail.sources.kind.streaming'
  | 'albumDetail.sources.labels'
  | 'albumDetail.sources.linksAria'
  | 'albumDetail.sources.releaseAria'
  | 'albumDetail.sources.releaseDetails'
  | 'albumDetail.status.libraryReady'
  | 'albumDetail.status.addedToQueue'
  | 'albumDetail.status.copiedCover'
  | 'albumDetail.status.readingSignal'
  | 'albumDetail.status.unknownGenre'
  | 'albumDetail.status.unknownLength'
  | 'albumDetail.status.unknownYear'
  | 'albumDetail.tab.credits'
  | 'albumDetail.tab.information'
  | 'albumDetail.tab.releases'
  | 'albumDetail.tab.sources'
  | 'albumDetail.tab.tracks'
  | 'albumDetail.texture.discs'
  | 'albumDetail.tracks.action.like'
  | 'albumDetail.tracks.action.likeTitle'
  | 'albumDetail.tracks.action.unlike'
  | 'albumDetail.tracks.action.unlikeTitle'
  | 'albumDetail.tracks.aria'
  | 'albumDetail.tracks.column.signal'
  | 'albumDetail.tracks.column.time'
  | 'albumDetail.tracks.column.title'
  | 'albumDetail.tracks.confirm.delete'
  | 'albumDetail.tracks.empty'
  | 'albumDetail.tracks.error.actionUnavailable'
  | 'albumDetail.tracks.error.desktopBridgeActions'
  | 'albumDetail.tracks.error.desktopBridgeEdit'
  | 'albumDetail.tracks.error.desktopBridgeRead'
  | 'albumDetail.tracks.error.noCoverSaved'
  | 'albumDetail.tracks.error.noCoverToCopy'
  | 'albumDetail.tracks.error.remoteFileAction'
  | 'albumDetail.tracks.formatAria'
  | 'albumDetail.tracks.loadMore'
  | 'albumDetail.tracks.loading'
  | 'albumDetail.tracks.status.addedToPlaylist'
  | 'albumDetail.tracks.status.albumNotFound'
  | 'albumDetail.tracks.status.notInQueue'
  | 'albumDetail.tracks.status.reloadedTags'
  | 'albumDetail.tracks.status.removedFromQueue'
  | 'albumDetail.tracks.summaryAria';

type ArtistDetailTranslationKey =
  | 'artistDetail.action.addToQueue'
  | 'artistDetail.action.back'
  | 'artistDetail.action.playArtist'
  | 'artistDetail.action.readingArtist'
  | 'artistDetail.action.refreshInfo'
  | 'artistDetail.action.shuffle'
  | 'artistDetail.albums.aria'
  | 'artistDetail.albums.count'
  | 'artistDetail.albums.empty'
  | 'artistDetail.albums.error.desktopBridge'
  | 'artistDetail.albums.heading'
  | 'artistDetail.albums.loadedCount'
  | 'artistDetail.aroundWeb.aria'
  | 'artistDetail.aroundWeb.heading'
  | 'artistDetail.aria.details'
  | 'artistDetail.aria.events'
  | 'artistDetail.aria.facts'
  | 'artistDetail.aria.metadata'
  | 'artistDetail.aria.onlineSources'
  | 'artistDetail.aria.overview'
  | 'artistDetail.aria.relationshipMap'
  | 'artistDetail.aria.sections'
  | 'artistDetail.duration.hours'
  | 'artistDetail.duration.minutes'
  | 'artistDetail.duration.reading'
  | 'artistDetail.empty.relationships'
  | 'artistDetail.error.desktopBridgeRead'
  | 'artistDetail.events.configureProviders'
  | 'artistDetail.events.collapse'
  | 'artistDetail.events.collapsedHint'
  | 'artistDetail.events.count'
  | 'artistDetail.events.expand'
  | 'artistDetail.events.noConcerts'
  | 'artistDetail.events.noConcertsRegion'
  | 'artistDetail.events.providerKeysRequired'
  | 'artistDetail.events.venuePending'
  | 'artistDetail.fact.albums'
  | 'artistDetail.fact.loaded'
  | 'artistDetail.fact.sources'
  | 'artistDetail.fact.tracks'
  | 'artistDetail.label.artist'
  | 'artistDetail.label.overview'
  | 'artistDetail.meta.albums'
  | 'artistDetail.meta.loadedTracks'
  | 'artistDetail.meta.tracks'
  | 'artistDetail.missing.description'
  | 'artistDetail.missing.title'
  | 'artistDetail.overview.about'
  | 'artistDetail.overview.bioFallback'
  | 'artistDetail.relation.bpm'
  | 'artistDetail.relation.collaboration'
  | 'artistDetail.relation.evidence'
  | 'artistDetail.relation.genre'
  | 'artistDetail.relation.history'
  | 'artistDetail.relation.link'
  | 'artistDetail.relation.local'
  | 'artistDetail.relation.member'
  | 'artistDetail.relation.sameAlbum'
  | 'artistDetail.relation.similar'
  | 'artistDetail.section.concertInfo'
  | 'artistDetail.section.events'
  | 'artistDetail.section.localNetwork'
  | 'artistDetail.section.relationshipMap'
  | 'artistDetail.status.collectedLocally'
  | 'artistDetail.status.linkedArtists'
  | 'artistDetail.status.loadingSignals'
  | 'artistDetail.status.localLibrary'
  | 'artistDetail.status.readingRelationships'
  | 'artistDetail.status.readySoon'
  | 'artistDetail.tab.albums'
  | 'artistDetail.tab.overview'
  | 'artistDetail.tab.songs'
  | 'artistDetail.tracks.action.addToQueueAria'
  | 'artistDetail.tracks.action.more'
  | 'artistDetail.tracks.action.moreAria'
  | 'artistDetail.tracks.action.playNext'
  | 'artistDetail.tracks.action.playNextAria'
  | 'artistDetail.tracks.aria'
  | 'artistDetail.tracks.column.actions'
  | 'artistDetail.tracks.column.album'
  | 'artistDetail.tracks.column.signal'
  | 'artistDetail.tracks.column.time'
  | 'artistDetail.tracks.column.title'
  | 'artistDetail.tracks.confirm.delete'
  | 'artistDetail.tracks.empty'
  | 'artistDetail.tracks.error.actionUnavailable'
  | 'artistDetail.tracks.error.desktopBridgeActions'
  | 'artistDetail.tracks.error.desktopBridgeEdit'
  | 'artistDetail.tracks.error.desktopBridgeRead'
  | 'artistDetail.tracks.expandAll'
  | 'artistDetail.tracks.error.noCoverSaved'
  | 'artistDetail.tracks.error.noCoverToCopy'
  | 'artistDetail.tracks.error.remoteFileAction'
  | 'artistDetail.tracks.formatAria'
  | 'artistDetail.tracks.heading'
  | 'artistDetail.tracks.loadedCount'
  | 'artistDetail.tracks.loading'
  | 'artistDetail.tracks.loadingTrack'
  | 'artistDetail.tracks.status.addedToPlaylist'
  | 'artistDetail.tracks.status.albumNotFound'
  | 'artistDetail.tracks.status.notInQueue'
  | 'artistDetail.tracks.status.reloadedTags'
  | 'artistDetail.tracks.status.removedFromQueue'
  | 'artistDetail.tracks.unknownAlbum';

export type TranslationKey =
  | AlbumDetailTranslationKey
  | ArtistDetailTranslationKey
  | 'albumTagEditor.action.applyToForm'
  | 'albumTagEditor.action.cancel'
  | 'albumTagEditor.action.chooseCover'
  | 'albumTagEditor.action.close'
  | 'albumTagEditor.action.deleteAlbum'
  | 'albumTagEditor.action.loadEmbedded'
  | 'albumTagEditor.action.loading'
  | 'albumTagEditor.action.loadNetwork'
  | 'albumTagEditor.action.openInExplorer'
  | 'albumTagEditor.action.saveTags'
  | 'albumTagEditor.action.saving'
  | 'albumTagEditor.action.searchCandidates'
  | 'albumTagEditor.action.searching'
  | 'albumTagEditor.albumSummary'
  | 'albumTagEditor.cover.embeddedSuffix'
  | 'albumTagEditor.cover.localSuffix'
  | 'albumTagEditor.cover.networkSuffix'
  | 'albumTagEditor.currentAlbum'
  | 'albumTagEditor.currentAlbumAria'
  | 'albumTagEditor.discard.continue'
  | 'albumTagEditor.discard.discard'
  | 'albumTagEditor.discard.prompt'
  | 'albumTagEditor.duration.hoursMinutes'
  | 'albumTagEditor.duration.minutes'
  | 'albumTagEditor.duration.unknown'
  | 'albumTagEditor.error.chooseCoverUnsupported'
  | 'albumTagEditor.error.embeddedUnsupported'
  | 'albumTagEditor.error.fixYearBeforeSave'
  | 'albumTagEditor.error.networkTemporary'
  | 'albumTagEditor.error.networkUnsupported'
  | 'albumTagEditor.error.noReadableTrack'
  | 'albumTagEditor.error.openFolderUnsupported'
  | 'albumTagEditor.error.positiveInteger'
  | 'albumTagEditor.error.readTracksUnsupported'
  | 'albumTagEditor.field.album'
  | 'albumTagEditor.field.albumArtist'
  | 'albumTagEditor.field.cover'
  | 'albumTagEditor.field.genre'
  | 'albumTagEditor.field.year'
  | 'albumTagEditor.message.appliedNetwork'
  | 'albumTagEditor.message.noNetworkTags'
  | 'albumTagEditor.message.searchingNetwork'
  | 'albumTagEditor.network.aria'
  | 'albumTagEditor.network.column.candidate'
  | 'albumTagEditor.network.column.current'
  | 'albumTagEditor.network.column.field'
  | 'albumTagEditor.network.selectAll'
  | 'albumTagEditor.network.selectFields'
  | 'albumTagEditor.network.title'
  | 'albumTagEditor.saveDescription'
  | 'albumTagEditor.section.albumInfo'
  | 'albumTagEditor.section.albumInfoDescription'
  | 'albumTagEditor.subtitle.albumBatch'
  | 'albumTagEditor.subtitle.unsaved'
  | 'albumTagEditor.title'
  | 'albumTagEditor.value.albumCandidate'
  | 'albumTagEditor.value.empty'
  | 'albumTagEditor.value.existingCover'
  | 'albumTagEditor.value.networkCover'
  | 'albumTagEditor.value.unknownAlbum'
  | 'albumTagEditor.value.unknownArtist'
  | 'albumMenu.action.addToPlaylist'
  | 'albumMenu.action.addToQueue'
  | 'albumMenu.action.copyCover'
  | 'albumMenu.action.copyInfo'
  | 'albumMenu.action.deleteAlbum'
  | 'albumMenu.action.editTags'
  | 'albumMenu.action.likeAlbum'
  | 'albumMenu.action.playAlbum'
  | 'albumMenu.action.saveCover'
  | 'albumMenu.action.unlikeAlbum'
  | 'albumMenu.playlistSubmenu.aria'
  | 'albumMenu.playlistSubmenu.empty'
  | 'albumMenu.playlistSubmenu.itemCount'
  | 'albumMenu.playlistSubmenu.loading'
  | 'app.navigation.main'
  | 'app.navigation.utility'
  | 'app.toolbar.quickActions'
  | 'app.toolbar.windowControls'
  | 'app.window.minimize'
  | 'app.window.maximize'
  | 'app.window.restore'
  | 'app.window.fullscreen'
  | 'app.window.exitFullscreen'
  | 'app.window.close'
  | 'firstRun.action.finish'
  | 'firstRun.action.next'
  | 'firstRun.action.previous'
  | 'firstRun.action.skip'
  | 'firstRun.action.skipWizard'
  | 'firstRun.aria.steps'
  | 'firstRun.aria.summary'
  | 'firstRun.audio.asio.description'
  | 'firstRun.audio.asio.hint'
  | 'firstRun.audio.asio.label'
  | 'firstRun.audio.exclusive.description'
  | 'firstRun.audio.exclusive.hint'
  | 'firstRun.audio.exclusive.label'
  | 'firstRun.audio.linuxShared.description'
  | 'firstRun.audio.linuxShared.hint'
  | 'firstRun.audio.linuxShared.label'
  | 'firstRun.audio.shared.description'
  | 'firstRun.audio.shared.hint'
  | 'firstRun.audio.shared.label'
  | 'firstRun.audio.system.description'
  | 'firstRun.audio.system.hint'
  | 'firstRun.audio.system.label'
  | 'firstRun.accounts.cookie.description'
  | 'firstRun.accounts.cookie.title'
  | 'firstRun.accounts.login.description'
  | 'firstRun.accounts.login.title'
  | 'firstRun.accounts.note'
  | 'firstRun.accounts.open.description'
  | 'firstRun.accounts.open.title'
  | 'firstRun.accounts.spotify.description'
  | 'firstRun.accounts.spotify.title'
  | 'firstRun.cache.chooseLocation'
  | 'firstRun.cache.useDefault'
  | 'firstRun.currentSelection'
  | 'firstRun.defaultLocation'
  | 'firstRun.description'
  | 'firstRun.error.desktopBridgeCache'
  | 'firstRun.error.desktopBridgeMusicFolder'
  | 'firstRun.error.desktopBridgeSave'
  | 'connectPage.controls.aria'
  | 'connectPage.controls.disconnect'
  | 'connectPage.controls.pause'
  | 'connectPage.controls.play'
  | 'connectPage.controls.stop'
  | 'connectPage.controls.volume'
  | 'connectPage.deviceState.available'
  | 'connectPage.deviceState.connected'
  | 'connectPage.deviceState.unavailable'
  | 'connectPage.deviceState.unsupported'
  | 'connectPage.devices.allHidden'
  | 'connectPage.devices.aria'
  | 'connectPage.devices.collapse'
  | 'connectPage.devices.empty'
  | 'connectPage.devices.emptyHint'
  | 'connectPage.devices.expand'
  | 'connectPage.devices.hiddenAria'
  | 'connectPage.devices.hiddenTitle'
  | 'connectPage.devices.kicker'
  | 'connectPage.devices.restoreAll'
  | 'connectPage.devices.restoreHint'
  | 'connectPage.devices.summary'
  | 'connectPage.devices.title'
  | 'connectPage.header.autoStart'
  | 'connectPage.header.description'
  | 'connectPage.header.kicker'
  | 'connectPage.header.refresh'
  | 'connectPage.hqplayer.enable'
  | 'connectPage.hqplayer.kicker'
  | 'connectPage.hqplayer.localDesktop'
  | 'connectPage.hqplayer.state.available'
  | 'connectPage.hqplayer.state.checking'
  | 'connectPage.hqplayer.state.disabled'
  | 'connectPage.hqplayer.state.notConfigured'
  | 'connectPage.hqplayer.state.unavailable'
  | 'connectPage.hqplayer.test'
  | 'connectPage.nowPlaying.aria'
  | 'connectPage.nowPlaying.chooseDevice'
  | 'connectPage.nowPlaying.coverReady'
  | 'connectPage.nowPlaying.coverWaiting'
  | 'connectPage.nowPlaying.dlnaPolling'
  | 'connectPage.nowPlaying.emptyTitle'
  | 'connectPage.nowPlaying.infoAria'
  | 'connectPage.nowPlaying.infoWaiting'
  | 'connectPage.nowPlaying.latency'
  | 'connectPage.nowPlaying.noOutput'
  | 'connectPage.nowPlaying.progressAria'
  | 'connectPage.outgoing.aria'
  | 'connectPage.outgoing.empty'
  | 'connectPage.outgoing.note'
  | 'connectPage.outgoing.recent'
  | 'connectPage.outgoing.title'
  | 'connectPage.receiver.aria'
  | 'connectPage.receiver.disable'
  | 'connectPage.receiver.discoveryHint'
  | 'connectPage.receiver.enable'
  | 'connectPage.receiver.fromClient'
  | 'connectPage.receiver.kicker'
  | 'connectPage.receiver.noClient'
  | 'connectPage.receiver.preparing'
  | 'connectPage.receiver.progressAria'
  | 'connectPage.receiver.state.disabled'
  | 'connectPage.receiver.state.idle'
  | 'connectPage.receiver.state.loading'
  | 'connectPage.receiver.state.playing'
  | 'connectPage.receiver.state.ready'
  | 'connectPage.receiver.stop'
  | 'connectPage.receiver.title'
  | 'connectPage.receiver.waitingTitle'
  | 'connectPage.stage.aria'
  | 'connectPage.state.connecting'
  | 'connectPage.state.discovering'
  | 'connectPage.state.error'
  | 'connectPage.state.idle'
  | 'connectPage.state.paused'
  | 'connectPage.state.playing'
  | 'connectPage.state.stopped'
  | 'connectPage.airplay.state.idle'
  | 'connectPage.airplay.state.playing'
  | 'connectPage.airplay.state.starting'
  | 'connectPage.airplay.state.unavailable'
  | 'connectPage.airplay.waitingTitle'
  | 'firstRun.library.chooseFolder'
  | 'firstRun.library.noneSelected'
  | 'firstRun.library.scanAfterFinish'
  | 'firstRun.message.saved'
  | 'firstRun.scan.balanced.description'
  | 'firstRun.scan.balanced.hint'
  | 'firstRun.scan.balanced.label'
  | 'firstRun.scan.low.description'
  | 'firstRun.scan.low.hint'
  | 'firstRun.scan.low.label'
  | 'firstRun.scan.performance.description'
  | 'firstRun.scan.performance.hint'
  | 'firstRun.scan.performance.label'
  | 'firstRun.step.audio.description'
  | 'firstRun.step.audio.eyebrow'
  | 'firstRun.step.audio.label'
  | 'firstRun.step.audio.title'
  | 'firstRun.step.appearance.description'
  | 'firstRun.step.appearance.eyebrow'
  | 'firstRun.step.appearance.label'
  | 'firstRun.step.appearance.title'
  | 'firstRun.step.accounts.description'
  | 'firstRun.step.accounts.eyebrow'
  | 'firstRun.step.accounts.label'
  | 'firstRun.step.accounts.title'
  | 'firstRun.step.cache.description'
  | 'firstRun.step.cache.eyebrow'
  | 'firstRun.step.cache.label'
  | 'firstRun.step.cache.title'
  | 'firstRun.step.library.description'
  | 'firstRun.step.library.eyebrow'
  | 'firstRun.step.library.label'
  | 'firstRun.step.library.title'
  | 'firstRun.step.scan.description'
  | 'firstRun.step.scan.eyebrow'
  | 'firstRun.step.scan.label'
  | 'firstRun.step.scan.title'
  | 'firstRun.step.summary.description'
  | 'firstRun.step.summary.eyebrow'
  | 'firstRun.step.summary.label'
  | 'firstRun.step.summary.title'
  | 'firstRun.summary.addLater'
  | 'firstRun.summary.accounts'
  | 'firstRun.summary.accountsLater'
  | 'firstRun.summary.cache'
  | 'firstRun.summary.kicker'
  | 'firstRun.summary.music'
  | 'firstRun.summary.noFileMove'
  | 'firstRun.summary.output'
  | 'firstRun.summary.readyDescription'
  | 'firstRun.summary.readyTitle'
  | 'firstRun.summary.scan'
  | 'firstRun.summary.scanWithFolder'
  | 'firstRun.summary.theme'
  | 'firstRun.summary.themeValue'
  | 'firstRun.theme.dark.description'
  | 'firstRun.theme.dark.hint'
  | 'firstRun.theme.light.description'
  | 'firstRun.theme.light.hint'
  | 'firstRun.theme.modeTitle'
  | 'firstRun.theme.presetTitle'
  | 'firstRun.theme.system.description'
  | 'firstRun.theme.system.hint'
  | 'firstRun.title'
  | 'downloads.action.addToQueue'
  | 'downloads.action.cancelJob'
  | 'downloads.action.changeFolder'
  | 'downloads.action.checkTools'
  | 'downloads.action.chooseFolder'
  | 'downloads.action.clearCompleted'
  | 'downloads.action.creating'
  | 'downloads.action.search'
  | 'downloads.action.searching'
  | 'downloads.description'
  | 'downloads.empty.noResults.description'
  | 'downloads.empty.noResults.title'
  | 'downloads.empty.queue.description'
  | 'downloads.empty.queue.title'
  | 'downloads.empty.searching.description'
  | 'downloads.empty.searching.title'
  | 'downloads.error.cookieFallback'
  | 'downloads.error.ipcUnavailable'
  | 'downloads.error.operationFailed'
  | 'downloads.folder.required'
  | 'downloads.job.imported'
  | 'downloads.job.savedTo'
  | 'downloads.job.waitingProgress'
  | 'downloads.message.clearedTerminal'
  | 'downloads.message.completed'
  | 'downloads.message.queued'
  | 'downloads.message.resultQueued'
  | 'downloads.queue.title'
  | 'downloads.search.aria'
  | 'downloads.search.downloadAudio'
  | 'downloads.search.joined'
  | 'downloads.search.placeholder'
  | 'downloads.search.providerErrorItem'
  | 'downloads.search.providerErrors'
  | 'downloads.search.scopeAria'
  | 'downloads.search.title'
  | 'downloads.search.unknownUploader'
  | 'downloads.search.views'
  | 'downloads.search.viewsWan'
  | 'downloads.settings.audioStrategy'
  | 'downloads.settings.bestAvailable'
  | 'downloads.settings.bindMvAfterImport'
  | 'downloads.settings.importToLibrary'
  | 'downloads.settings.outputDirectory'
  | 'downloads.settings.title'
  | 'downloads.status.bindingMv'
  | 'downloads.status.cancelled'
  | 'downloads.status.completed'
  | 'downloads.status.downloading'
  | 'downloads.status.extractingAudio'
  | 'downloads.status.failed'
  | 'downloads.status.importing'
  | 'downloads.status.probing'
  | 'downloads.status.queued'
  | 'downloads.title'
  | 'downloads.tools.notBundled'
  | 'downloads.tools.notDetected'
  | 'downloads.tools.title'
  | 'downloads.url.placeholder'
  | 'downloads.url.title'
  | 'accountProvider.bilibili'
  | 'accountProvider.kugou'
  | 'accountProvider.netease'
  | 'accountProvider.osu'
  | 'accountProvider.qqmusic'
  | 'accountProvider.soundcloud'
  | 'accountProvider.spotify'
  | 'accountProvider.tidal'
  | 'accountProvider.unknown'
  | 'accountProvider.youtube'
  | 'desktopLyrics.aria.stage'
  | 'desktopLyrics.control.close'
  | 'desktopLyrics.control.colorSwatch'
  | 'desktopLyrics.control.customColor'
  | 'desktopLyrics.control.decreaseFontSize'
  | 'desktopLyrics.control.decreaseScale'
  | 'desktopLyrics.control.increaseFontSize'
  | 'desktopLyrics.control.increaseScale'
  | 'desktopLyrics.control.lock'
  | 'desktopLyrics.control.resetPosition'
  | 'desktopLyrics.control.romanization'
  | 'desktopLyrics.control.themeColor'
  | 'desktopLyrics.control.translation'
  | 'desktopLyrics.control.translationShort'
  | 'desktopLyrics.primary.empty'
  | 'desktopLyrics.primary.instrumental'
  | 'desktopLyrics.secondary.waiting'
  | 'lyricsView.empty.instrumental'
  | 'lyricsView.empty.noLyrics'
  | 'mvPanel.action.close'
  | 'mvPanel.action.copied'
  | 'mvPanel.action.copy'
  | 'mvPanel.action.dismissUnavailable'
  | 'mvPanel.diagnostics.title'
  | 'mvPanel.notice.unavailable'
  | 'mvPanel.status.bilibiliBlocked'
  | 'mvPanel.status.databaseUnread'
  | 'mvPanel.status.externalRequired'
  | 'mvPanel.status.inAppUnavailable'
  | 'mvPanel.status.loadFailed'
  | 'mvPanel.status.loading'
  | 'mvPanel.status.localUnsupported'
  | 'mvPanel.status.missingUrl'
  | 'mvPanel.status.networkFailed'
  | 'mvPanel.status.notFound'
  | 'mvPanel.status.temporaryPlayback'
  | 'mvPanel.status.unavailable'
  | 'mvPanel.status.videoFailed'
  | 'miniPlayer.action.close'
  | 'miniPlayer.action.closeQueue'
  | 'miniPlayer.action.closeShort'
  | 'miniPlayer.action.next'
  | 'miniPlayer.action.openQueue'
  | 'miniPlayer.action.pause'
  | 'miniPlayer.action.play'
  | 'miniPlayer.action.previous'
  | 'miniPlayer.action.resetPosition'
  | 'miniPlayer.action.volume'
  | 'miniPlayer.aria.progress'
  | 'miniPlayer.aria.queue'
  | 'miniPlayer.aria.shell'
  | 'miniPlayer.aria.volume'
  | 'miniPlayer.artist.unknown'
  | 'miniPlayer.status.hqPlayerTakeover'
  | 'miniPlayer.status.queueEmpty'
  | 'miniPlayer.status.ready'
  | 'playerStatus.audioSpecifications'
  | 'playerStatus.ready'
  | 'playerStatus.streaming'
  | 'playerSpeed.label'
  | 'playerSpeed.reset'
  | 'playerVolume.fixed.disable'
  | 'playerVolume.fixed.enable'
  | 'playerVolume.fixed.enabled'
  | 'playerVolume.fixed.dsdAutoLocked'
  | 'playerVolume.fixed.title'
  | 'import.dragDrop.desktopBridgeUnavailable'
  | 'import.dragDrop.files.empty'
  | 'import.dragDrop.files.failed'
  | 'import.dragDrop.files.ignored'
  | 'import.dragDrop.files.imported'
  | 'import.dragDrop.files.summaryWithOutput'
  | 'import.dragDrop.noDroppedFiles'
  | 'import.dragDrop.overlay.description'
  | 'import.dragDrop.overlay.title'
  | 'import.dragDrop.paths.addedFolders'
  | 'import.dragDrop.paths.empty'
  | 'import.dragDrop.paths.failed'
  | 'import.dragDrop.paths.ignored'
  | 'import.dragDrop.paths.importedFiles'
  | 'import.dragDrop.paths.missing'
  | 'import.dragDrop.paths.scannedAudioFolders'
  | 'audioDrawer.action.close'
  | 'audioDrawer.action.copiedDiagnostics'
  | 'audioDrawer.action.copyDiagnostics'
  | 'audioDrawer.action.hideDevice'
  | 'audioDrawer.action.openAsioPanel'
  | 'audioDrawer.action.resetEngine'
  | 'audioDrawer.action.resetEngineBusy'
  | 'audioDrawer.action.resetEngineDone'
  | 'audioDrawer.action.restore'
  | 'audioDrawer.asioLatency.description'
  | 'audioDrawer.asioLatency.recommended'
  | 'audioDrawer.asioLatency.status'
  | 'audioDrawer.asioLatency.value'
  | 'audioDrawer.asioRoutes.title'
  | 'audioDrawer.badge.bitPerfectReady'
  | 'audioDrawer.badge.dspActive'
  | 'audioDrawer.badge.juceFallback'
  | 'audioDrawer.badge.juceOutput'
  | 'audioDrawer.badge.resampling'
  | 'audioDrawer.badge.soxrResampler'
  | 'audioDrawer.badge.speedUp'
  | 'audioDrawer.buffer.asio'
  | 'audioDrawer.buffer.auto'
  | 'audioDrawer.buffer.collapsedDescription'
  | 'audioDrawer.buffer.default'
  | 'audioDrawer.buffer.latencyProfile'
  | 'audioDrawer.buffer.low'
  | 'audioDrawer.buffer.profileDefault'
  | 'audioDrawer.buffer.safer'
  | 'audioDrawer.buffer.stable'
  | 'audioDrawer.buffer.title'
  | 'audioDrawer.buffer.ultraLow'
  | 'audioDrawer.device.asioDriver'
  | 'audioDrawer.device.lowLatency'
  | 'audioDrawer.device.selected'
  | 'audioDrawer.device.systemAudio'
  | 'audioDrawer.device.systemAudioDescription'
  | 'audioDrawer.device.systemDefault'
  | 'audioDrawer.device.systemDefaultOutput'
  | 'audioDrawer.device.systemOutput'
  | 'audioDrawer.device.systemSelectedRoute'
  | 'audioDrawer.empty.asioDevices'
  | 'audioDrawer.empty.hiddenDevices'
  | 'audioDrawer.empty.systemDevices'
  | 'audioDrawer.error.desktopBridgeUnavailable'
  | 'audioDrawer.meter.direct'
  | 'audioDrawer.meter.chain'
  | 'audioDrawer.meter.mode'
  | 'audioDrawer.meter.output'
  | 'audioDrawer.meter.rate'
  | 'audioDrawer.meter.resample'
  | 'audioDrawer.meter.source'
  | 'audioDrawer.meter.latency'
  | 'audioDrawer.guard.asioUnavailable.description'
  | 'audioDrawer.guard.asioUnavailable.title'
  | 'audioDrawer.guard.exclusiveInstability.description'
  | 'audioDrawer.guard.exclusiveInstability.title'
  | 'audioDrawer.guard.soxrFallback.description'
  | 'audioDrawer.guard.soxrFallback.title'
  | 'audioDrawer.latency.balanced'
  | 'audioDrawer.latency.balancedDetail'
  | 'audioDrawer.latency.lowLatency'
  | 'audioDrawer.latency.lowLatencyDetail'
  | 'audioDrawer.latency.stable'
  | 'audioDrawer.latency.stableDetail'
  | 'audioDrawer.mode.exclusive'
  | 'audioDrawer.mode.exclusiveCandidate'
  | 'audioDrawer.mode.directSound'
  | 'audioDrawer.mode.shared'
  | 'audioDrawer.note.asio'
  | 'audioDrawer.note.currentOutput'
  | 'audioDrawer.note.engine'
  | 'audioDrawer.note.juceOutput'
  | 'audioDrawer.note.juceDecode'
  | 'audioDrawer.note.dsdDop'
  | 'audioDrawer.note.asioNativeDsd'
  | 'audioDrawer.note.dsdAutoVolumeLock'
  | 'audioDrawer.note.releaseExclusiveOnPause'
  | 'audioDrawer.option.juceOutput'
  | 'audioDrawer.option.juceDecode'
  | 'audioDrawer.option.dsdDop'
  | 'audioDrawer.option.asioNativeDsd'
  | 'audioDrawer.option.dsdAutoVolumeLock'
  | 'audioDrawer.option.releaseExclusiveOnPause'
  | 'audioDrawer.option.active'
  | 'audioDrawer.option.set'
  | 'audioDrawer.option.automix'
  | 'audioDrawer.option.automixActive'
  | 'audioDrawer.option.automixDescription'
  | 'audioDrawer.option.rememberOutput'
  | 'audioDrawer.option.rememberOutputDescription'
  | 'audioDrawer.option.fixedVolume'
  | 'audioDrawer.option.fixedVolumeDescription'
  | 'audioDrawer.option.lowLoadPlaybackMode'
  | 'audioDrawer.option.lowLoadPlaybackModeDescription'
  | 'audioDrawer.option.lowLoadPlaybackEnhancements'
  | 'audioDrawer.option.lowLoadPlaybackEnhancementsDescription'
  | 'audioDrawer.option.showAsioPanelSettings'
  | 'audioDrawer.option.showAsioPanelSettingsDescription'
  | 'audioDrawer.option.alsaShared'
  | 'audioDrawer.option.alsaSharedDescription'
  | 'audioDrawer.option.directSound'
  | 'audioDrawer.option.directSoundDescription'
  | 'audioDrawer.option.linuxAutoShared'
  | 'audioDrawer.option.linuxAutoSharedDescription'
  | 'audioDrawer.option.sharedBackend'
  | 'audioDrawer.option.wasapiShared'
  | 'audioDrawer.option.wasapiSharedDescription'
  | 'audioDrawer.option.wasapiExclusive'
  | 'audioDrawer.option.wasapiExclusiveDescription'
  | 'audioDrawer.section.advancedOutput'
  | 'audioDrawer.section.advancedOutputDescription'
  | 'audioDrawer.section.automix'
  | 'audioDrawer.section.asioDevices'
  | 'audioDrawer.section.currentOutput'
  | 'audioDrawer.section.hiddenDevices'
  | 'audioDrawer.section.systemDevices'
  | 'audioDrawer.signal.balanceDsp'
  | 'audioDrawer.signal.bitPerfect'
  | 'audioDrawer.signal.dspOn'
  | 'audioDrawer.signal.eqOff'
  | 'audioDrawer.signal.eqOn'
  | 'audioDrawer.signal.asioSdkOutput'
  | 'audioDrawer.signal.ffmpegDecode'
  | 'audioDrawer.signal.dsdDop'
  | 'audioDrawer.signal.dsdDopFallback'
  | 'audioDrawer.signal.dsdDopStandby'
  | 'audioDrawer.signal.juceDecode'
  | 'audioDrawer.signal.juceDecodeFallback'
  | 'audioDrawer.signal.juceDecodeStandby'
  | 'audioDrawer.signal.nativeRate'
  | 'audioDrawer.signal.noActiveSource'
  | 'audioDrawer.signal.pending'
  | 'audioDrawer.signal.processed'
  | 'audioDrawer.signal.sharedMixer'
  | 'audioDrawer.signal.standardPath'
  | 'audioDrawer.status.noTrack'
  | 'audioDrawer.status.ratePending'
  | 'audioDrawer.status.sampleRatePending'
  | 'audioDrawer.title'
  | 'audioDrawer.warning.highOutputSampleRate'
  | 'audioProfessional.action.hideDetails'
  | 'audioProfessional.action.refresh'
  | 'audioProfessional.action.showDetails'
  | 'audioProfessional.badge.bitPerfect'
  | 'audioProfessional.badge.dsp'
  | 'audioProfessional.badge.protect'
  | 'audioProfessional.badge.replayGain'
  | 'audioProfessional.badge.resampling'
  | 'audioProfessional.badge.sampleMismatch'
  | 'audioProfessional.badge.warning'
  | 'audioProfessional.issue.reason'
  | 'audioProfessional.issue.audioLevelClipped'
  | 'audioProfessional.issue.audioLevelClippingRisk'
  | 'audioProfessional.issue.dspClippingRisk'
  | 'audioProfessional.issue.dspLimiterProtecting'
  | 'audioProfessional.issue.roomCorrectionBitPerfectDisabled'
  | 'audioProfessional.issue.roomCorrectionClippingRisk'
  | 'audioProfessional.issue.sharedMixRateTooHigh'
  | 'audioProfessional.issue.windowsDefaultFormatUnusual'
  | 'audioProfessional.group.directDsp'
  | 'audioProfessional.group.playbackChain'
  | 'audioProfessional.group.sampleRate'
  | 'audioProfessional.group.stability'
  | 'audioProfessional.signal.decode'
  | 'audioProfessional.signal.dsp'
  | 'audioProfessional.signal.fir'
  | 'audioProfessional.signal.headroom'
  | 'audioProfessional.signal.native'
  | 'audioProfessional.signal.output'
  | 'audioProfessional.signal.source'
  | 'audioProfessional.row.actualBuffer'
  | 'audioProfessional.row.actualDeviceSampleRate'
  | 'audioProfessional.row.bitDepth'
  | 'audioProfessional.row.bitPerfect'
  | 'audioProfessional.row.bitrate'
  | 'audioProfessional.row.buffered'
  | 'audioProfessional.row.channelBalance'
  | 'audioProfessional.row.channels'
  | 'audioProfessional.row.clippingProtection'
  | 'audioProfessional.row.codec'
  | 'audioProfessional.row.decodeBackend'
  | 'audioProfessional.row.decoderOutputSampleRate'
  | 'audioProfessional.row.deviceBuffer'
  | 'audioProfessional.row.eq'
  | 'audioProfessional.row.error'
  | 'audioProfessional.row.fileSampleRate'
  | 'audioProfessional.row.latencyProfile'
  | 'audioProfessional.row.outputBackend'
  | 'audioProfessional.row.outputDevice'
  | 'audioProfessional.row.outputLatency'
  | 'audioProfessional.row.outputMode'
  | 'audioProfessional.row.replayGain'
  | 'audioProfessional.row.protectLimiter'
  | 'audioProfessional.row.roomCorrection'
  | 'audioProfessional.row.requestedBuffer'
  | 'audioProfessional.row.requestedOutputSampleRate'
  | 'audioProfessional.row.resampler'
  | 'audioProfessional.row.resampling'
  | 'audioProfessional.row.sampleRateMismatch'
  | 'audioProfessional.row.signalPath'
  | 'audioProfessional.row.sharedDeviceSampleRate'
  | 'audioProfessional.row.sharedStability'
  | 'audioProfessional.row.soxr'
  | 'audioProfessional.row.state'
  | 'audioProfessional.row.underrun'
  | 'audioProfessional.row.warnings'
  | 'audioProfessional.summary.pending'
  | 'audioProfessional.title'
  | 'audioProfessional.value.disabled'
  | 'audioProfessional.value.dspPath'
  | 'audioProfessional.value.enabled'
  | 'audioProfessional.value.nativePath'
  | 'audioProfessional.value.no'
  | 'audioProfessional.value.pending'
  | 'audioProfessional.value.ready'
  | 'audioProfessional.value.sharedMixer'
  | 'audioProfessional.value.systemDefault'
  | 'audioProfessional.value.unknown'
  | 'audioProfessional.value.yes'
  | 'audioDrawer.todo.outputControls'
  | 'audioDrawer.todo.outputControlsDescription'
  | 'audioDrawer.troubleshooting.description'
  | 'audioDrawer.troubleshooting.hardAction'
  | 'audioDrawer.troubleshooting.hardBusy'
  | 'audioDrawer.troubleshooting.hardConfirm'
  | 'audioDrawer.troubleshooting.hardDone'
  | 'audioDrawer.troubleshooting.softAction'
  | 'audioDrawer.troubleshooting.softBusy'
  | 'audioDrawer.troubleshooting.softDone'
  | 'audioDrawer.troubleshooting.title'
  | 'common.available'
  | 'common.build'
  | 'common.checking'
  | 'common.dev'
  | 'common.disabled'
  | 'common.enabled'
  | 'common.loading'
  | 'common.na'
  | 'common.no'
  | 'common.ready'
  | 'common.unavailable'
  | 'common.yes'
  | 'library.action.refresh'
  | 'library.albums.card.tracks'
  | 'library.albums.confirm.deleteAlbumFiles'
  | 'library.albums.error.coverNotSaved'
  | 'library.albums.error.desktopBridge'
  | 'library.albums.error.noCopyableCover'
  | 'library.albums.error.noPlayableTracks'
  | 'library.albums.error.remoteEditUnsupported'
  | 'library.albums.listAria'
  | 'library.albums.loading'
  | 'library.albums.searchPlaceholder'
  | 'library.albums.sort.aria'
  | 'library.albums.sort.artist'
  | 'library.albums.sort.titleAsc'
  | 'library.albums.sort.titleDesc'
  | 'library.albums.title'
  | 'libraryDiagnostics.lab.description'
  | 'library.artists.error.desktopBridge'
  | 'library.artists.avatarPriority'
  | 'library.artists.listAria'
  | 'library.artists.loading'
  | 'library.artists.meta.albums'
  | 'library.artists.meta.noTracks'
  | 'library.artists.meta.tracks'
  | 'library.artists.searchPlaceholder'
  | 'library.artists.sort.aria'
  | 'library.artists.sort.frequent'
  | 'library.artists.sort.nameAsc'
  | 'library.artists.sort.nameDesc'
  | 'library.artists.title'
  | 'library.count.total'
  | 'library.sort.createdAsc'
  | 'library.sort.createdDesc'
  | 'library.sort.default'
  | 'library.sort.durationAsc'
  | 'library.sort.durationDesc'
  | 'library.sort.fileModifiedAsc'
  | 'library.sort.fileModifiedDesc'
  | 'library.sort.random'
  | 'library.sort.recent'
  | 'library.source.aria'
  | 'library.source.local'
  | 'library.source.allRemote'
  | 'library.source.remote'
  | 'library.trackRow.action.addToPlaylist'
  | 'library.trackRow.action.addToPlaylistLabel'
  | 'library.trackRow.action.addToQueue'
  | 'library.trackRow.action.addToQueueLabel'
  | 'library.trackRow.action.download'
  | 'library.trackRow.action.downloadLabel'
  | 'library.trackRow.action.downloading'
  | 'library.trackRow.action.downloadingLabel'
  | 'library.trackRow.action.more'
  | 'library.trackRow.action.moreLabel'
  | 'library.trackRow.actions'
  | 'library.trackRow.audioSpecifications'
  | 'library.trackRow.duplicateVersions.count'
  | 'library.trackRow.duplicateVersions.title'
  | 'library.trackRow.openAlbum'
  | 'library.trackRow.openArtist'
  | 'library.trackRow.status.playing'
  | 'library.trackRow.status.unavailable'
  | 'trackMenu.action.addToPlaylist'
  | 'trackMenu.action.playNext'
  | 'trackMenu.action.addToQueue'
  | 'trackMenu.action.like'
  | 'trackMenu.action.unlike'
  | 'trackMenu.action.removeFromQueue'
  | 'trackMenu.action.removeFromPlaylist'
  | 'trackMenu.action.openOsuTiming'
  | 'trackMenu.action.editTags'
  | 'trackMenu.action.reloadEmbeddedTags'
  | 'trackMenu.action.clearLyricsCache'
  | 'trackMenu.action.goToAlbum'
  | 'trackMenu.action.showInFolder'
  | 'trackMenu.action.copyPath'
  | 'trackMenu.action.openSystem'
  | 'trackMenu.action.copyNameArtist'
  | 'trackMenu.action.copyCover'
  | 'trackMenu.action.saveCover'
  | 'trackMenu.action.deleteSong'
  | 'folders.action.addScan'
  | 'folders.action.browse'
  | 'folders.action.cancel'
  | 'folders.action.open'
  | 'folders.action.play'
  | 'folders.action.queue'
  | 'folders.action.random'
  | 'folders.action.refresh'
  | 'folders.action.remove'
  | 'folders.action.scan'
  | 'folders.confirm.deleteTrack'
  | 'folders.confirm.removeRoot'
  | 'folders.count.tracks'
  | 'folders.detail.importHint'
  | 'folders.detail.libraryFolders'
  | 'folders.detail.root'
  | 'folders.detail.selectFolder'
  | 'folders.detail.subfolder'
  | 'folders.duration.hours'
  | 'folders.duration.hoursMinutes'
  | 'folders.duration.minutes'
  | 'folders.empty.noScan'
  | 'folders.empty.roots'
  | 'folders.error.actionFailed'
  | 'folders.error.desktopEditTags'
  | 'folders.error.desktopFileActions'
  | 'folders.error.desktopImport'
  | 'folders.error.desktopManage'
  | 'folders.error.noCoverSaved'
  | 'folders.error.noCoverToCopy'
  | 'folders.error.notFolder'
  | 'folders.error.pathMissing'
  | 'folders.error.permission'
  | 'folders.error.trackActionUnavailable'
  | 'folders.filters.includeSubfolders'
  | 'folders.filters.label'
  | 'folders.filters.searchPlaceholder'
  | 'folders.message.addedToPlaylist'
  | 'folders.message.alreadyScanning'
  | 'folders.message.folderAddedScanStarted'
  | 'folders.message.folderRemoved'
  | 'folders.message.loadedPartial'
  | 'folders.message.loadedTracks'
  | 'folders.message.noPlayableTracks'
  | 'folders.message.queuedTracks'
  | 'folders.message.scanCancelled'
  | 'folders.message.scanStarted'
  | 'folders.metrics.duration'
  | 'folders.metrics.label'
  | 'folders.metrics.size'
  | 'folders.metrics.subfolders'
  | 'folders.metrics.tracks'
  | 'folders.panel.addFolder'
  | 'folders.panel.import'
  | 'folders.panel.manage'
  | 'folders.panel.scan'
  | 'folders.panel.selectedRoot'
  | 'folders.panel.status'
  | 'folders.phase.checkingCache'
  | 'folders.phase.discovering'
  | 'folders.phase.extractingCovers'
  | 'folders.phase.finished'
  | 'folders.phase.groupingAlbums'
  | 'folders.phase.readingMetadata'
  | 'folders.phase.writingDatabase'
  | 'folders.prompt.choosePlaylist'
  | 'folders.prompt.createPlaylist'
  | 'folders.queueSource.recursive'
  | 'folders.scan.progress'
  | 'folders.sidebar.kicker'
  | 'folders.sidebar.title'
  | 'folders.sort.album'
  | 'folders.sort.artist'
  | 'folders.sort.duration'
  | 'folders.sort.quality'
  | 'folders.sort.random'
  | 'folders.sort.recent'
  | 'folders.sort.title'
  | 'folders.status.cancelled'
  | 'folders.status.completed'
  | 'folders.status.failed'
  | 'folders.status.queued'
  | 'folders.status.running'
  | 'folders.statusLine.loadingTracks'
  | 'folders.statusLine.preparingQueue'
  | 'notice.browserFolderPicker'
  | 'notice.browserFilePicker'
  | 'notice.windowControlsDesktop'
  | 'notice.accountExpired'
  | 'notice.accountExpired.title'
  | 'notice.action.close'
  | 'notice.action.closeNotice'
  | 'notice.action.ignore'
  | 'notice.action.openReport'
  | 'notice.audioError.description'
  | 'notice.audioError.title'
  | 'notice.audioDefaultFormatWarning'
  | 'notice.diagnosticsCrash.description'
  | 'notice.importFiles.empty'
  | 'notice.importFiles.failed'
  | 'notice.importFiles.imported'
  | 'notice.importFiles.skipped'
  | 'notice.openFiles.partial'
  | 'notice.reportOpened'
  | 'notice.reportOpenedPath'
  | 'notice.updateAvailable'
  | 'notice.updateAvailableVersion'
  | 'notice.updateDownloaded'
  | 'notice.updateDownloadedVersion'
  | 'punctuation.clauseSeparator'
  | 'punctuation.listSeparator'
  | 'queue.action.clear'
  | 'queue.action.dragLabel'
  | 'queue.action.dragTitle'
  | 'queue.action.generateRandom'
  | 'queue.action.generateFromHistory'
  | 'queue.action.generatingHistory'
  | 'queue.action.generatingRandom'
  | 'queue.action.autoFill'
  | 'queue.action.like'
  | 'queue.action.more'
  | 'queue.action.openFolder'
  | 'queue.action.play'
  | 'queue.action.playNext'
  | 'queue.action.remove'
  | 'queue.action.shuffle'
  | 'queue.count'
  | 'queue.empty.description'
  | 'queue.empty.title'
  | 'queue.error.desktopBridge'
  | 'queue.error.noHistoryTracks'
  | 'queue.error.noRandomTracks'
  | 'queue.header.kicker'
  | 'queue.header.title'
  | 'queue.historySource'
  | 'queue.now.actions'
  | 'queue.now.emptyDescription'
  | 'queue.now.emptyTitle'
  | 'queue.now.kicker'
  | 'queue.now.quality'
  | 'queue.now.sourceFallback'
  | 'queue.now.waitingAudio'
  | 'queue.quality.unknown'
  | 'queue.randomSource'
  | 'queue.repeat.all'
  | 'queue.repeat.mode'
  | 'queue.repeat.off'
  | 'queue.repeat.one'
  | 'queue.tools'
  | 'queue.upNext.kicker'
  | 'queue.upNext.title'
  | 'queue.upNext.waitingCount'
  | 'queue.unknownAlbum'
  | 'queue.unknownArtist'
  | 'route.albums.description'
  | 'route.albums.label'
  | 'route.artists.description'
  | 'route.artists.label'
  | 'route.audioSettings.description'
  | 'route.audioSettings.label'
  | 'route.connect.description'
  | 'route.connect.label'
  | 'route.dsp.description'
  | 'route.dsp.label'
  | 'route.downloads.description'
  | 'route.downloads.label'
  | 'route.folders.description'
  | 'route.folders.label'
  | 'route.history.description'
  | 'route.history.label'
  | 'historyPage.action.clear'
  | 'historyPage.action.refreshInvalid'
  | 'historyPage.confirm.clear'
  | 'historyPage.date.none'
  | 'historyPage.duration.hoursMinutes'
  | 'historyPage.duration.minutes'
  | 'historyPage.empty.description'
  | 'historyPage.empty.title'
  | 'historyPage.error.desktopBridgeRead'
  | 'historyPage.filter.all'
  | 'historyPage.filter.completed'
  | 'historyPage.filter.month'
  | 'historyPage.filter.today'
  | 'historyPage.filter.week'
  | 'historyPage.header.kicker'
  | 'historyPage.header.title'
  | 'historyPage.list.aria'
  | 'historyPage.list.doubleClick'
  | 'historyPage.list.source'
  | 'historyPage.list.unknownAlbum'
  | 'historyPage.list.unknownArtist'
  | 'historyPage.list.unknownSource'
  | 'historyPage.loadMore'
  | 'historyPage.loading'
  | 'historyPage.loadingMore'
  | 'historyPage.metric.plays'
  | 'historyPage.metric.tracks'
  | 'historyPage.refresh.none'
  | 'historyPage.refresh.removed'
  | 'historyPage.refresh.running'
  | 'historyPage.recent.aria'
  | 'historyPage.recent.count'
  | 'historyPage.recent.empty'
  | 'historyPage.recent.kicker'
  | 'historyPage.recent.title'
  | 'historyPage.search.placeholder'
  | 'historyPage.summary.all.count'
  | 'historyPage.summary.all.duration'
  | 'historyPage.summary.all.group'
  | 'historyPage.summary.all.latest'
  | 'historyPage.summary.all.tracks'
  | 'historyPage.summary.aria'
  | 'historyPage.summary.completed.count'
  | 'historyPage.summary.completed.duration'
  | 'historyPage.summary.completed.group'
  | 'historyPage.summary.completed.latest'
  | 'historyPage.summary.completed.tracks'
  | 'historyPage.summary.month.count'
  | 'historyPage.summary.month.duration'
  | 'historyPage.summary.month.group'
  | 'historyPage.summary.month.latest'
  | 'historyPage.summary.month.tracks'
  | 'historyPage.summary.today.count'
  | 'historyPage.summary.today.duration'
  | 'historyPage.summary.today.group'
  | 'historyPage.summary.today.latest'
  | 'historyPage.summary.today.tracks'
  | 'historyPage.summary.week.count'
  | 'historyPage.summary.week.duration'
  | 'historyPage.summary.week.group'
  | 'historyPage.summary.week.latest'
  | 'historyPage.summary.week.tracks'
  | 'historyPage.toolbar.aria'
  | 'home.artistLeaderboard.aria'
  | 'home.artistLeaderboard.completionRate'
  | 'home.artistLeaderboard.emptyDescription'
  | 'home.artistLeaderboard.emptyTitle'
  | 'home.artistLeaderboard.playCount'
  | 'home.artistLeaderboard.title'
  | 'home.count.tracks'
  | 'home.date.none'
  | 'home.date.unknown'
  | 'home.duration.hoursMinutes'
  | 'home.duration.hoursOnly'
  | 'home.duration.minutes'
  | 'home.duration.zeroMinutes'
  | 'home.error.albumNotFound'
  | 'home.error.artistNotFound'
  | 'home.error.desktopBridgeRandom'
  | 'home.error.desktopBridgeRecommend'
  | 'home.error.desktopBridgeView'
  | 'home.favoriteAlbums.aria'
  | 'home.favoriteAlbums.emptyDescription'
  | 'home.favoriteAlbums.emptyTitle'
  | 'home.favoriteAlbums.title'
  | 'home.hero.action.continue'
  | 'home.hero.action.viewQueue'
  | 'home.hero.aria'
  | 'home.hero.defaultTitle'
  | 'home.hero.description.empty'
  | 'home.hero.description.resume'
  | 'home.hero.kicker'
  | 'home.hero.nowPlaying'
  | 'home.hero.recentSignal'
  | 'home.hero.statsAria'
  | 'home.metric.albums'
  | 'home.metric.albumsDetail'
  | 'home.metric.artists'
  | 'home.metric.folders'
  | 'home.metric.foldersDetail'
  | 'home.metric.openAria'
  | 'home.metric.songs'
  | 'home.metric.songsDetail'
  | 'home.month.label'
  | 'home.nowMeta.empty'
  | 'home.preferences.aria'
  | 'home.recent.emptyAddedDescription'
  | 'home.recent.emptyAddedTitle'
  | 'home.recent.emptyPlayedDescription'
  | 'home.recent.emptyPlayedTitle'
  | 'home.recent.nextPage'
  | 'home.recent.prevPage'
  | 'home.recent.tab.added'
  | 'home.recent.tab.played'
  | 'home.recent.tabsAria'
  | 'home.recent.title'
  | 'home.recommend.emptyDescription'
  | 'home.recommend.emptyTitle'
  | 'home.recommend.refresh'
  | 'home.recommend.refreshing'
  | 'home.recommend.title'
  | 'home.signalVisualizer.aria'
  | 'home.status.loading'
  | 'home.week.emptyHint'
  | 'home.week.listenDuration'
  | 'home.week.playCount'
  | 'home.week.times'
  | 'home.week.title'
  | 'home.weekday.fri'
  | 'home.weekday.mon'
  | 'home.weekday.wed'
  | 'home.weeklyHeatmap.activeWeeks'
  | 'home.weeklyHeatmap.aria'
  | 'home.weeklyHeatmap.dayAria'
  | 'home.weeklyHeatmap.dayTitle'
  | 'route.home.description'
  | 'route.home.label'
  | 'route.inbox.description'
  | 'route.inbox.label'
  | 'inboxPage.action.addToQueue'
  | 'inboxPage.action.generatePlaylist'
  | 'inboxPage.batch.latest'
  | 'inboxPage.batch.recentAll'
  | 'inboxPage.batch.selected'
  | 'inboxPage.date.none'
  | 'inboxPage.empty.description'
  | 'inboxPage.empty.noMatch'
  | 'inboxPage.empty.title'
  | 'inboxPage.empty.tryFilter'
  | 'inboxPage.error.desktopBridgeRead'
  | 'inboxPage.facets.allAlbums'
  | 'inboxPage.facets.allArtists'
  | 'inboxPage.facets.allFolders'
  | 'inboxPage.facets.aria'
  | 'inboxPage.filter.all'
  | 'inboxPage.filter.aria'
  | 'inboxPage.filter.clear'
  | 'inboxPage.filter.metadataIssue'
  | 'inboxPage.filter.missingCover'
  | 'inboxPage.filter.suspiciousFile'
  | 'inboxPage.filter.unknownAlbum'
  | 'inboxPage.filter.unknownArtist'
  | 'inboxPage.hero.kicker'
  | 'inboxPage.loading'
  | 'inboxPage.processing.aria'
  | 'inboxPage.processing.pending'
  | 'inboxPage.quality.aria'
  | 'inboxPage.quality.coverCompleteness'
  | 'inboxPage.quality.metadataCompleteness'
  | 'inboxPage.quality.unknownArtistAlbum'
  | 'inboxPage.search.aria'
  | 'inboxPage.search.placeholder'
  | 'inboxPage.stats.aria'
  | 'inboxPage.stats.currentResults'
  | 'inboxPage.stats.newSongs'
  | 'inboxPage.status.all'
  | 'inboxPage.status.aria'
  | 'inboxPage.status.ignored'
  | 'inboxPage.status.pending'
  | 'inboxPage.status.processed'
  | 'inboxPage.story.aria'
  | 'inboxPage.story.clean'
  | 'inboxPage.story.empty'
  | 'inboxPage.story.kicker'
  | 'inboxPage.story.newAlbums'
  | 'inboxPage.story.newArtists'
  | 'inboxPage.story.summaryAlbums'
  | 'inboxPage.story.summaryArtists'
  | 'inboxPage.story.summaryTracks'
  | 'inboxPage.story.totalDuration'
  | 'inboxPage.story.warningMetadataIssue'
  | 'inboxPage.story.warningMissingCover'
  | 'inboxPage.story.withWarnings'
  | 'inboxPage.toolbar.aria'
  | 'inboxPage.toolbar.batch'
  | 'route.importFile.description'
  | 'route.importFile.label'
  | 'route.importFolder.description'
  | 'route.importFolder.label'
  | 'importFolder.hero.note'
  | 'nowPlaying.action.openLyrics'
  | 'nowPlaying.description'
  | 'nowPlaying.emptyDescription'
  | 'nowPlaying.emptyTitle'
  | 'nowPlaying.kicker'
  | 'nowPlaying.localFile'
  | 'nowPlaying.ready'
  | 'nowPlaying.state.idle'
  | 'nowPlaying.state.playing'
  | 'nowPlaying.title'
  | 'route.liked.description'
  | 'route.liked.label'
  | 'route.lyrics.description'
  | 'route.lyrics.label'
  | 'route.lyricsSettings.description'
  | 'route.lyricsSettings.label'
  | 'lyricsSettings.background.mode.cover'
  | 'lyricsSettings.background.mode.coverColor'
  | 'lyricsSettings.action.choose'
  | 'lyricsSettings.action.fonts'
  | 'lyricsSettings.action.match'
  | 'lyricsSettings.action.music'
  | 'lyricsSettings.action.reset'
  | 'lyricsSettings.action.search'
  | 'lyricsSettings.background.blur'
  | 'lyricsSettings.background.brightness'
  | 'lyricsSettings.background.chooseWallpaper'
  | 'lyricsSettings.background.clearWallpaper'
  | 'lyricsSettings.background.clearWallpaperHint'
  | 'lyricsSettings.background.highResolutionCover'
  | 'lyricsSettings.background.highResolutionCoverDescription'
  | 'lyricsSettings.background.mode.customWallpaper'
  | 'lyricsSettings.background.mode.theme'
  | 'lyricsSettings.background.modeAria'
  | 'lyricsSettings.background.modeDescription'
  | 'lyricsSettings.background.opacity'
  | 'lyricsSettings.background.readability'
  | 'lyricsSettings.background.readabilityDescription'
  | 'lyricsSettings.background.scale'
  | 'lyricsSettings.background.showControls'
  | 'lyricsSettings.background.smartReadable'
  | 'lyricsSettings.background.smartReadableDescription'
  | 'lyricsSettings.background.title'
  | 'lyricsSettings.background.tuning'
  | 'lyricsSettings.background.tuningDescription'
  | 'lyricsSettings.background.wallpaperSaved'
  | 'lyricsSettings.candidate.allSources'
  | 'lyricsSettings.candidate.results'
  | 'lyricsSettings.candidate.risk.high'
  | 'lyricsSettings.candidate.risk.low'
  | 'lyricsSettings.candidate.risk.medium'
  | 'lyricsSettings.candidate.reason.albumMatch'
  | 'lyricsSettings.candidate.reason.artistExact'
  | 'lyricsSettings.candidate.reason.artistMismatch'
  | 'lyricsSettings.candidate.reason.autoAccept'
  | 'lyricsSettings.candidate.reason.candidateOnlyCover'
  | 'lyricsSettings.candidate.reason.candidateOnlyDuration'
  | 'lyricsSettings.candidate.reason.coverIntent'
  | 'lyricsSettings.candidate.reason.durationClose'
  | 'lyricsSettings.candidate.reason.durationExact'
  | 'lyricsSettings.candidate.reason.durationMismatch'
  | 'lyricsSettings.candidate.reason.embeddedTag'
  | 'lyricsSettings.candidate.reason.localSidecar'
  | 'lyricsSettings.candidate.reason.rejectedByUser'
  | 'lyricsSettings.candidate.reason.syncedDurationSafe'
  | 'lyricsSettings.candidate.reason.titleExact'
  | 'lyricsSettings.candidate.reason.titleSimilar'
  | 'lyricsSettings.candidate.reason.versionConflict'
  | 'lyricsSettings.candidate.reason.versionMatch'
  | 'lyricsSettings.candidate.sourceFilters'
  | 'lyricsSettings.candidate.type.instrumental'
  | 'lyricsSettings.candidate.type.lyrics'
  | 'lyricsSettings.candidate.type.plain'
  | 'lyricsSettings.candidate.type.synced'
  | 'lyricsSettings.currentTrack.instrumentalMarked'
  | 'lyricsSettings.currentTrack.markInstrumental'
  | 'lyricsSettings.currentTrack.markInstrumentalHint'
  | 'lyricsSettings.currentTrack.rematch'
  | 'lyricsSettings.currentTrack.rematchHint'
  | 'lyricsSettings.currentTrack.restartOnApply'
  | 'lyricsSettings.currentTrack.restartOnApplyDescription'
  | 'lyricsSettings.currentTrack.searchHint'
  | 'lyricsSettings.currentTrack.searchInput'
  | 'lyricsSettings.currentTrack.searchLyrics'
  | 'lyricsSettings.currentTrack.searchPlaceholder'
  | 'lyricsSettings.currentTrack.title'
  | 'lyricsSettings.display.autoOpenCandidatePanel'
  | 'lyricsSettings.display.chooseMiniPlayerColor'
  | 'lyricsSettings.display.coverMiniPlayerHint'
  | 'lyricsSettings.display.customColor'
  | 'lyricsSettings.display.defaultMicrosoftYahei'
  | 'lyricsSettings.display.desktopFont'
  | 'lyricsSettings.display.desktopLyrics'
  | 'lyricsSettings.display.desktopLyricsDescription'
  | 'lyricsSettings.display.desktopOpacity'
  | 'lyricsSettings.display.desktopOpacityDescription'
  | 'lyricsSettings.display.desktopRomanization'
  | 'lyricsSettings.display.desktopTranslation'
  | 'lyricsSettings.display.disableMvTrackInfoAutoShow'
  | 'lyricsSettings.display.enableLyrics'
  | 'lyricsSettings.display.enableLyricsDescription'
  | 'lyricsSettings.display.hideEmptyState'
  | 'lyricsSettings.display.hideEmptyStateDescription'
  | 'lyricsSettings.display.hideTrackInfo'
  | 'lyricsSettings.display.lockDesktopLyrics'
  | 'lyricsSettings.display.lockDesktopLyricsDescription'
  | 'lyricsSettings.display.matchThreshold'
  | 'lyricsSettings.display.matchThresholdDescription'
  | 'lyricsSettings.display.miniPlayer'
  | 'lyricsSettings.display.miniPlayerAutoHide'
  | 'lyricsSettings.display.miniPlayerAutoHideDescription'
  | 'lyricsSettings.display.miniPlayerAutoMv'
  | 'lyricsSettings.display.miniPlayerAutoMvDescription'
  | 'lyricsSettings.display.miniPlayerColor'
  | 'lyricsSettings.display.miniPlayerColorMode'
  | 'lyricsSettings.display.miniPlayerDefaultDark'
  | 'lyricsSettings.display.miniPlayerDescription'
  | 'lyricsSettings.display.miniPlayerHint'
  | 'lyricsSettings.display.miniPlayerOpacity'
  | 'lyricsSettings.display.miniPlayerPalette'
  | 'lyricsSettings.display.preferUtatenKana'
  | 'lyricsSettings.display.preferUtatenKanaDescription'
  | 'lyricsSettings.display.resetDesktopPosition'
  | 'lyricsSettings.display.resetDesktopPositionHint'
  | 'lyricsSettings.display.showRomanization'
  | 'lyricsSettings.display.showRomanizationDescription'
  | 'lyricsSettings.display.showTranslation'
  | 'lyricsSettings.display.showTranslationDescription'
  | 'lyricsSettings.display.title'
  | 'lyricsSettings.display.useMiniPlayerColor'
  | 'lyricsSettings.drawer.aria'
  | 'lyricsSettings.drawer.close'
  | 'lyricsSettings.drawer.title'
  | 'lyricsSettings.engine.autoMatch'
  | 'lyricsSettings.engine.provider'
  | 'lyricsSettings.engine.threshold'
  | 'lyricsSettings.engine.title'
  | 'lyricsSettings.font.applySystem'
  | 'lyricsSettings.font.chooseInstalled'
  | 'lyricsSettings.font.custom'
  | 'lyricsSettings.font.desktopOnly'
  | 'lyricsSettings.font.importDesktop'
  | 'lyricsSettings.font.importFile'
  | 'lyricsSettings.font.lyricsOnly'
  | 'lyricsSettings.font.restoreDesktopDefault'
  | 'lyricsSettings.font.restoreLyricsDefault'
  | 'lyricsSettings.font.system'
  | 'lyricsSettings.fontPicker.aria'
  | 'lyricsSettings.fontPicker.chooseFile'
  | 'lyricsSettings.fontPicker.close'
  | 'lyricsSettings.fontPicker.preview'
  | 'lyricsSettings.fontPicker.searchPlaceholder'
  | 'lyricsSettings.fontPicker.title'
  | 'lyricsSettings.provider.cached'
  | 'lyricsSettings.provider.amllTtml'
  | 'lyricsSettings.provider.amllTtmlDescription'
  | 'lyricsSettings.provider.chineseCatalogDescription'
  | 'lyricsSettings.provider.genius'
  | 'lyricsSettings.provider.kugou'
  | 'lyricsSettings.provider.kuwo'
  | 'lyricsSettings.provider.local'
  | 'lyricsSettings.provider.lrclib'
  | 'lyricsSettings.provider.lrclibDescription'
  | 'lyricsSettings.provider.manual'
  | 'lyricsSettings.provider.musixmatch'
  | 'lyricsSettings.provider.netease'
  | 'lyricsSettings.provider.none'
  | 'lyricsSettings.provider.qqmusic'
  | 'lyricsSettings.preview.primary'
  | 'lyricsSettings.preview.secondary'
  | 'lyricsSettings.online.autoSearch'
  | 'lyricsSettings.online.autoSearchDescription'
  | 'lyricsSettings.online.autoSaveSidecar'
  | 'lyricsSettings.online.autoSaveSidecarDescription'
  | 'lyricsSettings.online.deepSearch'
  | 'lyricsSettings.online.deepSearchDescription'
  | 'lyricsSettings.online.enable'
  | 'lyricsSettings.online.enableDescription'
  | 'lyricsSettings.online.sources'
  | 'lyricsSettings.online.sourcesDescription'
  | 'lyricsSettings.online.title'
  | 'lyricsSettings.status.applied'
  | 'lyricsSettings.status.applying'
  | 'lyricsSettings.status.markedInstrumental'
  | 'lyricsSettings.status.noCandidates'
  | 'lyricsSettings.status.noPlayingTrack'
  | 'lyricsSettings.status.normal'
  | 'lyricsSettings.status.off'
  | 'lyricsSettings.status.on'
  | 'lyricsSettings.status.auto'
  | 'lyricsSettings.status.rematchingCandidates'
  | 'lyricsSettings.status.searchingCandidates'
  | 'lyricsSettings.style.chooseLyricsColor'
  | 'lyricsSettings.style.contextOpacity'
  | 'lyricsSettings.style.fontSize'
  | 'lyricsSettings.style.lineMaxChars'
  | 'lyricsSettings.style.lineMaxCharsValue'
  | 'lyricsSettings.style.lineSpacing'
  | 'lyricsSettings.style.lyricsColor'
  | 'lyricsSettings.style.lyricsColorPalette'
  | 'lyricsSettings.style.lyricsFont'
  | 'lyricsSettings.style.secondaryFontSize'
  | 'lyricsSettings.style.showControls'
  | 'lyricsSettings.style.showControlsDescription'
  | 'lyricsSettings.style.useColor'
  | 'lyricsSettings.timing.defaultOffset'
  | 'lyricsSettings.timing.globalOffset'
  | 'lyricsSettings.timing.restoreDefaults'
  | 'lyricsSettings.timing.restoreDefaultsHint'
  | 'lyricsSettings.timing.showPerTrackOffset'
  | 'lyricsSettings.timing.smartAlignment'
  | 'lyricsSettings.timing.smartAlignmentDescription'
  | 'lyricsSettings.timing.timelineCorrection'
  | 'lyricsSettings.timing.timelineCorrectionDescription'
  | 'lyricsSettings.timing.title'
  | 'lyricsSettings.wordHighlight.clarity'
  | 'lyricsSettings.wordHighlight.clarityDescription'
  | 'lyricsSettings.wordHighlight.description'
  | 'lyricsSettings.wordHighlight.title'
  | 'route.mvSettings.description'
  | 'route.mvSettings.label'
  | 'mvSettings.action.chooseFile'
  | 'mvSettings.action.close'
  | 'mvSettings.action.collapseNetwork'
  | 'mvSettings.action.dragReorder'
  | 'mvSettings.action.dragSource'
  | 'mvSettings.action.expandNetwork'
  | 'mvSettings.action.findLocal'
  | 'mvSettings.action.openExternal'
  | 'mvSettings.action.refresh'
  | 'mvSettings.action.removeSelected'
  | 'mvSettings.action.searchNetwork'
  | 'mvSettings.aria.candidates'
  | 'mvSettings.aria.drawer'
  | 'mvSettings.aria.engineStatus'
  | 'mvSettings.aria.maxQuality'
  | 'mvSettings.aria.maxQualityOptions'
  | 'mvSettings.aria.networkSources'
  | 'mvSettings.aria.selectedQuality'
  | 'mvSettings.aria.selectedQualityOptions'
  | 'mvSettings.badge.credentialsMain'
  | 'mvSettings.badge.proxyOnly'
  | 'mvSettings.binding.selectedMv'
  | 'mvSettings.binding.title'
  | 'mvSettings.candidate.external'
  | 'mvSettings.candidate.inApp'
  | 'mvSettings.custom.apply'
  | 'mvSettings.custom.description'
  | 'mvSettings.custom.directDash'
  | 'mvSettings.custom.input'
  | 'mvSettings.custom.placeholder'
  | 'mvSettings.custom.playing'
  | 'mvSettings.custom.title'
  | 'mvSettings.custom.videoTitle'
  | 'mvSettings.engine.mvTitle'
  | 'mvSettings.engine.network'
  | 'mvSettings.engine.quality'
  | 'mvSettings.engine.selected'
  | 'mvSettings.engine.title'
  | 'mvSettings.error.noActiveTrackBinding'
  | 'mvSettings.error.noActiveTrackMatching'
  | 'mvSettings.error.noActiveTrackNetworkSearch'
  | 'mvSettings.error.databaseUnavailable'
  | 'mvSettings.error.noLocalCandidates'
  | 'mvSettings.error.noNetworkCandidates'
  | 'mvSettings.general.enabled'
  | 'mvSettings.immersive.blur'
  | 'mvSettings.immersive.autoScale'
  | 'mvSettings.immersive.autoScaleDescription'
  | 'mvSettings.immersive.brightness'
  | 'mvSettings.immersive.description'
  | 'mvSettings.immersive.dragHint'
  | 'mvSettings.immersive.hideLyrics'
  | 'mvSettings.immersive.hideLyricsDescription'
  | 'mvSettings.immersive.lyricsReadability'
  | 'mvSettings.immersive.lyricsReadabilityDescription'
  | 'mvSettings.immersive.overlay'
  | 'mvSettings.immersive.overlayHint'
  | 'mvSettings.immersive.positionX'
  | 'mvSettings.immersive.positionY'
  | 'mvSettings.immersive.reset'
  | 'mvSettings.immersive.title'
  | 'mvSettings.immersive.tuning'
  | 'mvSettings.immersive.visualHint'
  | 'mvSettings.immersive.zoom'
  | 'mvSettings.network.autoApply'
  | 'mvSettings.network.autoApplyThreshold'
  | 'mvSettings.network.autoApplyThresholdDescription'
  | 'mvSettings.network.autoPreload'
  | 'mvSettings.network.autoPreloadDescription'
  | 'mvSettings.network.diagnosticsReport'
  | 'mvSettings.network.diagnosticsReportDescription'
  | 'mvSettings.network.maxQuality'
  | 'mvSettings.network.preferHighestViewCount'
  | 'mvSettings.network.preferHighestViewCountDescription'
  | 'mvSettings.network.replayAudioOnChange'
  | 'mvSettings.network.replayAudioOnChangeDescription'
  | 'mvSettings.network.restartAudioOnLoad'
  | 'mvSettings.network.restartAudioOnLoadDescription'
  | 'mvSettings.network.syncMode'
  | 'mvSettings.network.syncMode.balanced'
  | 'mvSettings.network.syncMode.precise'
  | 'mvSettings.network.syncMode.stable'
  | 'mvSettings.network.syncModeDescription'
  | 'mvSettings.network.title'
  | 'mvSettings.offset.aria'
  | 'mvSettings.offset.description'
  | 'mvSettings.offset.earlier'
  | 'mvSettings.offset.earlierShort'
  | 'mvSettings.offset.input'
  | 'mvSettings.offset.later'
  | 'mvSettings.offset.laterShort'
  | 'mvSettings.offset.replay'
  | 'mvSettings.offset.replayTitle'
  | 'mvSettings.offset.reset'
  | 'mvSettings.offset.resetShort'
  | 'mvSettings.offset.slider'
  | 'mvSettings.offset.startDescription'
  | 'mvSettings.offset.startInput'
  | 'mvSettings.offset.startTitle'
  | 'mvSettings.offset.step'
  | 'mvSettings.offset.title'
  | 'mvSettings.provider.local'
  | 'mvSettings.quality.max'
  | 'mvSettings.search.input'
  | 'mvSettings.search.placeholder'
  | 'mvSettings.search.useCurrentSong'
  | 'mvSettings.status.auto'
  | 'mvSettings.status.noActiveTrack'
  | 'mvSettings.status.none'
  | 'mvSettings.status.off'
  | 'mvSettings.status.on'
  | 'mvSettings.title'
  | 'route.playlists.description'
  | 'route.playlists.label'
  | 'playlistsPage.action.importFile'
  | 'playlistsPage.action.newLocal'
  | 'playlistsPage.daily.subtitle'
  | 'playlistsPage.daily.title'
  | 'playlistsPage.empty.create'
  | 'playlistsPage.empty.createFirst'
  | 'playlistsPage.empty.local'
  | 'playlistsPage.error.desktopBridgeDailyRecommend'
  | 'playlistsPage.form.cancel'
  | 'playlistsPage.form.create'
  | 'playlistsPage.form.nameAria'
  | 'playlistsPage.form.placeholder'
  | 'playlistsPage.importStreaming.add'
  | 'playlistsPage.importStreaming.adding'
  | 'playlistsPage.importStreaming.placeholder'
  | 'playlistsPage.importStreaming.title'
  | 'playlistsPage.prompt.newLocalName'
  | 'playlistsPage.status.createdLocal'
  | 'playlistsPage.status.importedStreamingPlaylist'
  | 'playlistsPage.status.importingStreamingPlaylist'
  | 'playlistsPage.status.loading'
  | 'playlistsPage.status.refreshedDaily'
  | 'playlistsPage.status.refreshingDaily'
  | 'playlistsPage.view.aria'
  | 'playlistsPage.view.local'
  | 'playlistsPage.view.streamingFavorites'
  | 'route.plugins.description'
  | 'route.plugins.label'
  | 'route.queue.description'
  | 'route.queue.label'
  | 'route.remote.description'
  | 'route.remote.label'
  | 'route.settings.description'
  | 'route.settings.label'
  | 'route.songs.description'
  | 'route.songs.label'
  | 'songs.action.clearList'
  | 'songs.action.openRecovery'
  | 'songs.duplicatesOnly'
  | 'songs.error.albumNotFound'
  | 'songs.error.artistNotFound'
  | 'songs.error.desktopBridgeClear'
  | 'songs.error.desktopBridgeFileActions'
  | 'songs.error.desktopBridgeLyricsCache'
  | 'songs.error.desktopBridgeMaintain'
  | 'songs.error.desktopBridgePlay'
  | 'songs.error.desktopBridgePlaylists'
  | 'songs.error.desktopBridgeRead'
  | 'songs.error.desktopBridgeVersions'
  | 'songs.importHint'
  | 'songs.queueSource.local'
  | 'songs.queueSource.remote'
  | 'songs.search.placeholder'
  | 'songs.sort.album'
  | 'songs.sort.artist'
  | 'songs.sort.artistAlbum'
  | 'songs.sort.createdAsc'
  | 'songs.sort.createdDesc'
  | 'songs.sort.default'
  | 'songs.sort.durationAsc'
  | 'songs.sort.durationDesc'
  | 'songs.sort.fileModifiedAsc'
  | 'songs.sort.fileModifiedDesc'
  | 'songs.sort.frequent'
  | 'songs.sort.menuAria'
  | 'songs.sort.qualityAsc'
  | 'songs.sort.qualityDesc'
  | 'songs.sort.random'
  | 'songs.sort.recent'
  | 'songs.sort.titleAsc'
  | 'songs.sort.titleDesc'
  | 'songs.trackList.aria'
  | 'songs.trackList.empty'
  | 'route.streaming.description'
  | 'route.streaming.label'
  | 'streaming.empty.notFoundAlbum'
  | 'streaming.empty.notFoundArtist'
  | 'streaming.empty.notFoundPlaylist'
  | 'streaming.empty.notFoundTrack'
  | 'streaming.empty.searchHint'
  | 'streaming.hero.currentProvider'
  | 'streaming.hero.description'
  | 'streaming.hero.meterAria'
  | 'streaming.hero.preparingSearch'
  | 'streaming.hero.title'
  | 'streaming.provider.available'
  | 'streaming.provider.disabled'
  | 'streaming.provider.loggedIn'
  | 'streaming.provider.notLoggedIn'
  | 'streaming.providers.aria'
  | 'streaming.quality.high'
  | 'streaming.quality.highDescription'
  | 'streaming.quality.hires'
  | 'streaming.quality.hiresDescription'
  | 'streaming.quality.label'
  | 'streaming.quality.lossless'
  | 'streaming.quality.losslessDescription'
  | 'streaming.quality.max'
  | 'streaming.quality.maxDescription'
  | 'streaming.quality.menuAria'
  | 'streaming.quality.standard'
  | 'streaming.quality.standardDescription'
  | 'streaming.quality.switchFailed'
  | 'streaming.quality.switched'
  | 'streaming.result.count'
  | 'streaming.result.searching'
  | 'streaming.result.searchingEllipsis'
  | 'streaming.search.placeholder'
  | 'streaming.tab.album'
  | 'streaming.tab.artist'
  | 'streaming.tab.playlist'
  | 'streaming.tab.track'
  | 'streaming.tabs.aria'
  | 'settings.about.audioHost.description'
  | 'settings.about.audioHost.title'
  | 'settings.about.devMode.description'
  | 'settings.about.devMode.title'
  | 'settings.about.nativeSqlite.description'
  | 'settings.about.nativeSqlite.title'
  | 'settings.about.updates.action.afdian'
  | 'settings.about.updates.action.check'
  | 'settings.about.updates.action.checking'
  | 'settings.about.updates.action.discord'
  | 'settings.about.updates.action.history'
  | 'settings.about.updates.action.qq'
  | 'settings.about.updates.autoCheck'
  | 'settings.about.updates.currentVersion'
  | 'settings.about.updates.description'
  | 'settings.about.updates.lastChecked'
  | 'settings.about.updates.latestVersion'
  | 'settings.about.updates.progress.aria'
  | 'settings.about.updates.progress.downloading'
  | 'settings.about.updates.progress.ready'
  | 'settings.about.updates.releaseNotes'
  | 'settings.about.updates.releaseNotesEmpty'
  | 'settings.about.updates.releaseNotesPending'
  | 'settings.about.updates.state.available'
  | 'settings.about.updates.state.checking'
  | 'settings.about.updates.state.disabled'
  | 'settings.about.updates.state.downloaded'
  | 'settings.about.updates.state.downloading'
  | 'settings.about.updates.state.error'
  | 'settings.about.updates.state.idle'
  | 'settings.about.updates.state.notAvailable'
  | 'settings.about.updates.status'
  | 'settings.about.updates.title'
  | 'settings.about.version.description'
  | 'settings.about.version.title'
  | 'settings.appearance.density.compact'
  | 'settings.appearance.density.description'
  | 'settings.appearance.density.standard'
  | 'settings.appearance.density.title'
  | 'settings.appearance.artistAvatars.action.clear'
  | 'settings.appearance.artistAvatars.action.queueing'
  | 'settings.appearance.artistAvatars.action.refreshMissing'
  | 'settings.appearance.artistAvatars.description'
  | 'settings.appearance.artistAvatars.fallback'
  | 'settings.appearance.artistAvatars.message.cleared'
  | 'settings.appearance.artistAvatars.message.desktopBridgeClear'
  | 'settings.appearance.artistAvatars.message.desktopBridgeRefresh'
  | 'settings.appearance.artistAvatars.message.enableFirst'
  | 'settings.appearance.artistAvatars.message.queued'
  | 'settings.appearance.artistAvatars.title'
  | 'settings.appearance.artistAvatars.toggle'
  | 'settings.appearance.albumCoverShape.description'
  | 'settings.appearance.albumCoverShape.rounded'
  | 'settings.appearance.albumCoverShape.square'
  | 'settings.appearance.albumCoverShape.title'
  | 'settings.appearance.font.choose'
  | 'settings.appearance.font.chinese.description'
  | 'settings.appearance.font.chinese.title'
  | 'settings.appearance.font.fallback.description'
  | 'settings.appearance.font.fallback.title'
  | 'settings.appearance.font.main.description'
  | 'settings.appearance.font.main.title'
  | 'settings.appearance.fontSize.description'
  | 'settings.appearance.fontSize.title'
  | 'settings.appearance.lineHeight.description'
  | 'settings.appearance.lineHeight.title'
  | 'settings.appearance.nowPlayingCoverColor.description'
  | 'settings.appearance.nowPlayingCoverColor.title'
  | 'settings.appearance.reset.action'
  | 'settings.appearance.reset.description'
  | 'settings.appearance.reset.title'
  | 'settings.appearance.textDepth.description'
  | 'settings.appearance.textDepth.title'
  | 'settings.appearance.wallpaper.blur'
  | 'settings.appearance.wallpaper.brightness'
  | 'settings.appearance.wallpaper.choose'
  | 'settings.appearance.wallpaper.clear'
  | 'settings.appearance.wallpaper.description'
  | 'settings.appearance.wallpaper.landscapePath'
  | 'settings.appearance.wallpaper.portraitChoose'
  | 'settings.appearance.wallpaper.portraitClear'
  | 'settings.appearance.wallpaper.portraitPath'
  | 'settings.appearance.wallpaper.scale'
  | 'settings.appearance.wallpaper.title'
  | 'settings.appearance.wallpaper.uiOpacity'
  | 'settings.appearance.wallpaper.unifiedOpacity'
  | 'settings.appearance.wallpaper.videoPause.minimized'
  | 'settings.appearance.wallpaper.videoPause.never'
  | 'settings.appearance.wallpaper.videoPause.smart'
  | 'settings.appearance.wallpaper.videoStatus'
  | 'settings.appearance.wallpaper.visualProtection'
  | 'settings.appearance.sidebar.count'
  | 'settings.appearance.sidebar.collapse'
  | 'settings.appearance.sidebar.description'
  | 'settings.appearance.sidebar.expand'
  | 'settings.appearance.sidebar.fixed'
  | 'settings.appearance.sidebar.hidden'
  | 'settings.appearance.sidebar.hideAria'
  | 'settings.appearance.sidebar.mainGroup'
  | 'settings.appearance.sidebar.moveDown'
  | 'settings.appearance.sidebar.moveDownAria'
  | 'settings.appearance.sidebar.moveUp'
  | 'settings.appearance.sidebar.moveUpAria'
  | 'settings.appearance.sidebar.noItems'
  | 'settings.appearance.sidebar.reset'
  | 'settings.appearance.sidebar.showAria'
  | 'settings.appearance.sidebar.summary.allVisible'
  | 'settings.appearance.sidebar.summary.hidden'
  | 'settings.appearance.sidebar.title'
  | 'settings.appearance.sidebar.utilityGroup'
  | 'settings.appearance.sidebar.visible'
  | 'settings.appearance.theme.dark'
  | 'settings.appearance.theme.description'
  | 'settings.appearance.theme.followSystem'
  | 'settings.appearance.theme.light'
  | 'settings.appearance.themeSchedule.darkAt'
  | 'settings.appearance.themeSchedule.description'
  | 'settings.appearance.themeSchedule.lightAt'
  | 'settings.appearance.themeSchedule.status.disabled'
  | 'settings.appearance.themeSchedule.status.enabled'
  | 'settings.appearance.themeSchedule.title'
  | 'settings.appearance.themeSchedule.toggle'
  | 'settings.appearance.themeSchedule.toggleAria'
  | 'settings.appearance.theme.title'
  | 'settings.appearance.themePreset.berryDream'
  | 'settings.appearance.themePreset.berryDream.description'
  | 'settings.appearance.themePreset.classic'
  | 'settings.appearance.themePreset.classic.description'
  | 'settings.appearance.themePreset.amberNoir'
  | 'settings.appearance.themePreset.amberNoir.description'
  | 'settings.appearance.themePreset.caramelPudding'
  | 'settings.appearance.themePreset.caramelPudding.description'
  | 'settings.appearance.themePreset.cottonCloud'
  | 'settings.appearance.themePreset.cottonCloud.description'
  | 'settings.appearance.themePreset.darkSideMoon'
  | 'settings.appearance.themePreset.darkSideMoon.description'
  | 'settings.appearance.themePreset.description'
  | 'settings.appearance.themePreset.echoTwilight'
  | 'settings.appearance.themePreset.echoTwilight.description'
  | 'settings.appearance.themePreset.graphiteAurora'
  | 'settings.appearance.themePreset.graphiteAurora.description'
  | 'settings.appearance.themePreset.lemonMochi'
  | 'settings.appearance.themePreset.lemonMochi.description'
  | 'settings.appearance.themePreset.matchaCream'
  | 'settings.appearance.themePreset.matchaCream.description'
  | 'settings.appearance.themePreset.melonCream'
  | 'settings.appearance.themePreset.melonCream.description'
  | 'settings.appearance.themePreset.mintCandy'
  | 'settings.appearance.themePreset.mintCandy.description'
  | 'settings.appearance.themePreset.neonCandy'
  | 'settings.appearance.themePreset.neonCandy.description'
  | 'settings.appearance.themePreset.nyanCat'
  | 'settings.appearance.themePreset.nyanCat.description'
  | 'settings.appearance.themePreset.childrenDoodle'
  | 'settings.appearance.themePreset.childrenDoodle.description'
  | 'settings.appearance.themePreset.oceanStudio'
  | 'settings.appearance.themePreset.oceanStudio.description'
  | 'settings.appearance.themePreset.peachSoda'
  | 'settings.appearance.themePreset.peachSoda.description'
  | 'settings.appearance.themePreset.seaSaltJelly'
  | 'settings.appearance.themePreset.seaSaltJelly.description'
  | 'settings.appearance.themePreset.sakuraMilk'
  | 'settings.appearance.themePreset.sakuraMilk.description'
  | 'settings.appearance.themePreset.strawberryCookie'
  | 'settings.appearance.themePreset.strawberryCookie.description'
  | 'settings.appearance.themePreset.rosewoodVinyl'
  | 'settings.appearance.themePreset.rosewoodVinyl.description'
  | 'settings.appearance.themePreset.shibuyaNight'
  | 'settings.appearance.themePreset.shibuyaNight.description'
  | 'settings.appearance.themePreset.kyotoKurenai'
  | 'settings.appearance.themePreset.kyotoKurenai.description'
  | 'settings.appearance.themePreset.ukiyoIndigo'
  | 'settings.appearance.themePreset.ukiyoIndigo.description'
  | 'settings.appearance.themePreset.fujiSnow'
  | 'settings.appearance.themePreset.fujiSnow.description'
  | 'settings.appearance.themePreset.matsuriLantern'
  | 'settings.appearance.themePreset.matsuriLantern.description'
  | 'settings.appearance.themePreset.ginzaNoir'
  | 'settings.appearance.themePreset.ginzaNoir.description'
  | 'settings.appearance.themePreset.frostJazz'
  | 'settings.appearance.themePreset.frostJazz.description'
  | 'settings.appearance.themePreset.FINAL'
  | 'settings.appearance.themePreset.FINAL.description'
  | 'settings.appearance.themePreset.title'
  | 'settings.appearance.themePreset.wisteriaBubble'
  | 'settings.appearance.themePreset.wisteriaBubble.description'
  | 'settings.appearance.themeCustom.action.autoFix'
  | 'settings.appearance.themeCustom.action.copyDarkToLight'
  | 'settings.appearance.themeCustom.action.copyLightToDark'
  | 'settings.appearance.themeCustom.action.create'
  | 'settings.appearance.themeCustom.action.delete'
  | 'settings.appearance.themeCustom.action.duplicate'
  | 'settings.appearance.themeCustom.action.export'
  | 'settings.appearance.themeCustom.action.import'
  | 'settings.appearance.themeCustom.action.rename'
  | 'settings.appearance.themeCustom.action.reset'
  | 'settings.appearance.themeCustom.action.save'
  | 'settings.appearance.themeCustom.advanced.hide'
  | 'settings.appearance.themeCustom.advanced.show'
  | 'settings.appearance.themeCustom.collapse'
  | 'settings.appearance.themeCustom.expand'
  | 'settings.appearance.themeCustom.description'
  | 'settings.appearance.themeCustom.field.accent'
  | 'settings.appearance.themeCustom.field.accent.description'
  | 'settings.appearance.themeCustom.field.accentStrong'
  | 'settings.appearance.themeCustom.field.accentStrong.description'
  | 'settings.appearance.themeCustom.field.appBg'
  | 'settings.appearance.themeCustom.field.appBg.description'
  | 'settings.appearance.themeCustom.field.appBg2'
  | 'settings.appearance.themeCustom.field.appBg2.description'
  | 'settings.appearance.themeCustom.field.appBg3'
  | 'settings.appearance.themeCustom.field.appBg3.description'
  | 'settings.appearance.themeCustom.field.border'
  | 'settings.appearance.themeCustom.field.border.description'
  | 'settings.appearance.themeCustom.field.buttonText'
  | 'settings.appearance.themeCustom.field.buttonText.description'
  | 'settings.appearance.themeCustom.field.chip'
  | 'settings.appearance.themeCustom.field.chip.description'
  | 'settings.appearance.themeCustom.field.cornerRadius'
  | 'settings.appearance.themeCustom.field.cornerRadius.description'
  | 'settings.appearance.themeCustom.field.danger'
  | 'settings.appearance.themeCustom.field.danger.description'
  | 'settings.appearance.themeCustom.field.field'
  | 'settings.appearance.themeCustom.field.field.description'
  | 'settings.appearance.themeCustom.field.focus'
  | 'settings.appearance.themeCustom.field.focus.description'
  | 'settings.appearance.themeCustom.field.glass'
  | 'settings.appearance.themeCustom.field.glass.description'
  | 'settings.appearance.themeCustom.field.heading'
  | 'settings.appearance.themeCustom.field.heading.description'
  | 'settings.appearance.themeCustom.field.motionEnabled'
  | 'settings.appearance.themeCustom.field.motionEnabled.description'
  | 'settings.appearance.themeCustom.field.motionIntensity'
  | 'settings.appearance.themeCustom.field.motionIntensity.description'
  | 'settings.appearance.themeCustom.field.motionSpeed'
  | 'settings.appearance.themeCustom.field.motionSpeed.description'
  | 'settings.appearance.themeCustom.field.muted'
  | 'settings.appearance.themeCustom.field.muted.description'
  | 'settings.appearance.themeCustom.field.onAccent'
  | 'settings.appearance.themeCustom.field.onAccent.description'
  | 'settings.appearance.themeCustom.field.panel'
  | 'settings.appearance.themeCustom.field.panelBlur'
  | 'settings.appearance.themeCustom.field.panelBlur.description'
  | 'settings.appearance.themeCustom.field.panel.description'
  | 'settings.appearance.themeCustom.field.panelOpacity'
  | 'settings.appearance.themeCustom.field.panelOpacity.description'
  | 'settings.appearance.themeCustom.field.panelSoft'
  | 'settings.appearance.themeCustom.field.panelSoft.description'
  | 'settings.appearance.themeCustom.field.player'
  | 'settings.appearance.themeCustom.field.player.description'
  | 'settings.appearance.themeCustom.field.row'
  | 'settings.appearance.themeCustom.field.row.description'
  | 'settings.appearance.themeCustom.field.rowActive'
  | 'settings.appearance.themeCustom.field.rowActive.description'
  | 'settings.appearance.themeCustom.field.rowHover'
  | 'settings.appearance.themeCustom.field.rowHover.description'
  | 'settings.appearance.themeCustom.field.saturation'
  | 'settings.appearance.themeCustom.field.saturation.description'
  | 'settings.appearance.themeCustom.field.secondary'
  | 'settings.appearance.themeCustom.field.secondary.description'
  | 'settings.appearance.themeCustom.field.shadow'
  | 'settings.appearance.themeCustom.field.shadow.description'
  | 'settings.appearance.themeCustom.field.sidebar'
  | 'settings.appearance.themeCustom.field.sidebar.description'
  | 'settings.appearance.themeCustom.field.success'
  | 'settings.appearance.themeCustom.field.success.description'
  | 'settings.appearance.themeCustom.field.text'
  | 'settings.appearance.themeCustom.field.text.description'
  | 'settings.appearance.themeCustom.field.titlebar'
  | 'settings.appearance.themeCustom.field.titlebar.description'
  | 'settings.appearance.themeCustom.field.warning'
  | 'settings.appearance.themeCustom.field.warning.description'
  | 'settings.appearance.themeCustom.group.advanced'
  | 'settings.appearance.themeCustom.group.advanced.description'
  | 'settings.appearance.themeCustom.group.core'
  | 'settings.appearance.themeCustom.group.core.description'
  | 'settings.appearance.themeCustom.group.gradient'
  | 'settings.appearance.themeCustom.group.gradient.description'
  | 'settings.appearance.themeCustom.group.motion'
  | 'settings.appearance.themeCustom.group.motion.description'
  | 'settings.appearance.themeCustom.group.state'
  | 'settings.appearance.themeCustom.group.state.description'
  | 'settings.appearance.themeCustom.group.surface'
  | 'settings.appearance.themeCustom.group.surface.description'
  | 'settings.appearance.themeCustom.message.copied'
  | 'settings.appearance.themeCustom.message.created'
  | 'settings.appearance.themeCustom.message.fixed'
  | 'settings.appearance.themeCustom.message.exported'
  | 'settings.appearance.themeCustom.message.imported'
  | 'settings.appearance.themeCustom.message.importFailed'
  | 'settings.appearance.themeCustom.message.invalidColor'
  | 'settings.appearance.themeCustom.message.lowContrast'
  | 'settings.appearance.themeCustom.message.reset'
  | 'settings.appearance.themeCustom.message.saved'
  | 'settings.appearance.themeCustom.myThemes.description'
  | 'settings.appearance.themeCustom.myThemes.empty'
  | 'settings.appearance.themeCustom.myThemes.title'
  | 'settings.appearance.themeCustom.preview.description'
  | 'settings.appearance.themeCustom.preview.title'
  | 'settings.appearance.themeCustom.title'
  | 'settings.danger.database.action.check'
  | 'settings.danger.database.action.checking'
  | 'settings.danger.database.action.create'
  | 'settings.danger.database.action.creating'
  | 'settings.danger.database.action.discard'
  | 'settings.danger.database.action.discarding'
  | 'settings.danger.database.action.export'
  | 'settings.danger.database.action.exporting'
  | 'settings.danger.database.action.open'
  | 'settings.danger.database.action.rebuild'
  | 'settings.danger.database.action.rebuilding'
  | 'settings.danger.database.action.relaunch'
  | 'settings.danger.database.action.relaunching'
  | 'settings.danger.database.action.restore'
  | 'settings.danger.database.action.restoring'
  | 'settings.danger.database.action.scrub'
  | 'settings.danger.database.action.scrubbing'
  | 'settings.danger.database.badge.quarantined'
  | 'settings.danger.database.confirmPlaceholder'
  | 'settings.danger.database.confirmWord'
  | 'settings.danger.clearCache.description'
  | 'settings.danger.clearCache.title'
  | 'settings.danger.database.description.healthy'
  | 'settings.danger.database.description.loading'
  | 'settings.danger.database.description.quarantined'
  | 'settings.danger.database.description.recoverable'
  | 'settings.danger.database.description.unrecoverable'
  | 'settings.danger.database.health.corrupt'
  | 'settings.danger.database.health.idle'
  | 'settings.danger.database.health.ok'
  | 'settings.danger.database.health.unreadable'
  | 'settings.danger.database.kicker'
  | 'settings.danger.database.meta.archive'
  | 'settings.danger.database.meta.archiveHint'
  | 'settings.danger.database.meta.current'
  | 'settings.danger.database.meta.noArchive'
  | 'settings.danger.database.meta.noSnapshot'
  | 'settings.danger.database.meta.pending'
  | 'settings.danger.database.meta.snapshot'
  | 'settings.danger.database.meta.snapshotHint'
  | 'settings.danger.database.scanRunning'
  | 'settings.danger.database.steps.quarantined.1'
  | 'settings.danger.database.steps.quarantined.2'
  | 'settings.danger.database.steps.quarantined.3'
  | 'settings.danger.database.steps.recoverable.1'
  | 'settings.danger.database.steps.recoverable.2'
  | 'settings.danger.database.steps.recoverable.3'
  | 'settings.danger.database.steps.unrecoverable.1'
  | 'settings.danger.database.steps.unrecoverable.2'
  | 'settings.danger.database.steps.unrecoverable.3'
  | 'settings.danger.database.title'
  | 'settings.danger.database.unavailable.restore'
  | 'settings.danger.database.unavailable.scrub'
  | 'settings.danger.duplicates.action.clean'
  | 'settings.danger.duplicates.action.cleaning'
  | 'settings.danger.duplicates.action.scan'
  | 'settings.danger.duplicates.action.scanning'
  | 'settings.danger.duplicates.description'
  | 'settings.danger.duplicates.meta.notScanned'
  | 'settings.danger.duplicates.meta.release'
  | 'settings.danger.duplicates.meta.result'
  | 'settings.danger.duplicates.meta.resultValue'
  | 'settings.danger.duplicates.meta.scanTime'
  | 'settings.danger.duplicates.progress.clean.aria'
  | 'settings.danger.duplicates.progress.clean.description'
  | 'settings.danger.duplicates.progress.clean.title'
  | 'settings.danger.duplicates.progress.scan.aria'
  | 'settings.danger.duplicates.progress.scan.description'
  | 'settings.danger.duplicates.progress.scan.title'
  | 'settings.danger.duplicates.title'
  | 'settings.devices.empty'
  | 'settings.devices.title'
  | 'settings.general.artistInfoSources.description'
  | 'settings.general.artistInfoSources.title'
  | 'settings.general.artistStreamingAlbums.description'
  | 'settings.general.artistStreamingAlbums.title'
  | 'settings.general.backup.description'
  | 'settings.general.backup.export'
  | 'settings.general.backup.import'
  | 'settings.general.backup.title'
  | 'settings.general.dataBackup.action.backingUp'
  | 'settings.general.dataBackup.action.backupNow'
  | 'settings.general.dataBackup.action.chooseDirectory'
  | 'settings.general.dataBackup.action.choosingDirectory'
  | 'settings.general.dataBackup.action.importBackup'
  | 'settings.general.dataBackup.action.importingBackup'
  | 'settings.general.dataBackup.action.openDirectory'
  | 'settings.general.dataBackup.description'
  | 'settings.general.dataBackup.frequency.aria'
  | 'settings.general.dataBackup.frequency.days'
  | 'settings.general.dataBackup.frequency.monthly'
  | 'settings.general.dataBackup.hint.chooseDirectory'
  | 'settings.general.dataBackup.hint.directoryReady'
  | 'settings.general.dataBackup.meta.atPath'
  | 'settings.general.dataBackup.meta.directory'
  | 'settings.general.dataBackup.meta.lastBackup'
  | 'settings.general.dataBackup.meta.nextRun'
  | 'settings.general.dataBackup.meta.nextRunPending'
  | 'settings.general.dataBackup.meta.noneYet'
  | 'settings.general.dataBackup.meta.notSet'
  | 'settings.general.dataBackup.progress.completed'
  | 'settings.general.dataBackup.progress.failed'
  | 'settings.general.dataBackup.progress.finalizing'
  | 'settings.general.dataBackup.progress.measuring'
  | 'settings.general.dataBackup.progress.preparing'
  | 'settings.general.dataBackup.progress.scanning'
  | 'settings.general.dataBackup.progress.snapshot'
  | 'settings.general.dataBackup.progress.waiting'
  | 'settings.general.dataBackup.progress.writing'
  | 'settings.general.dataBackup.status.disabled'
  | 'settings.general.dataBackup.status.enabled'
  | 'settings.general.dataBackup.title'
  | 'settings.general.dataPackage.action.export'
  | 'settings.general.dataPackage.action.exporting'
  | 'settings.general.dataPackage.action.recovery'
  | 'settings.general.dataPackage.description'
  | 'settings.general.dataPackage.note'
  | 'settings.general.dataPackage.title'
  | 'settings.general.closeToTray'
  | 'settings.general.fastStartup.description'
  | 'settings.general.fastStartup.title'
  | 'settings.general.firstRunWizard.description'
  | 'settings.general.firstRunWizard.title'
  | 'settings.general.homeRandomHeroTitle.description'
  | 'settings.general.homeRandomHeroTitle.title'
  | 'settings.general.homeWaveformVisualizer.description'
  | 'settings.general.homeWaveformVisualizer.title'
  | 'settings.general.language.description'
  | 'settings.general.language.title'
  | 'settings.general.playerWaveformProgress.description'
  | 'settings.general.playerWaveformProgress.title'
  | 'settings.general.rememberWindowSize.description'
  | 'settings.general.rememberWindowSize.title'
  | 'settings.general.searchTraditionalVariants.description'
  | 'settings.general.searchTraditionalVariants.title'
  | 'settings.general.sidebarAutoHide.description'
  | 'settings.general.sidebarAutoHide.title'
  | 'settings.header.searchPlaceholder'
  | 'settings.integrations.discord.description'
  | 'settings.integrations.discord.action.refresh'
  | 'settings.integrations.discord.title'
  | 'settings.integrations.smtc.description'
  | 'settings.integrations.smtc.action.restart'
  | 'settings.integrations.smtc.action.restarting'
  | 'settings.integrations.taskbarPlayback.description'
  | 'settings.integrations.taskbarPlayback.title'
  | 'settings.integrations.smtc.title'
  | 'settings.integrations.lastfm.action.completeAuth'
  | 'settings.integrations.lastfm.action.connect'
  | 'settings.integrations.lastfm.action.disconnect'
  | 'settings.integrations.lastfm.action.refresh'
  | 'settings.integrations.lastfm.activeProgress'
  | 'settings.integrations.lastfm.activeTrack'
  | 'settings.integrations.lastfm.connection.description'
  | 'settings.integrations.lastfm.connection.title'
  | 'settings.integrations.lastfm.description'
  | 'settings.integrations.lastfm.lastNowPlaying'
  | 'settings.integrations.lastfm.lastScrobble'
  | 'settings.integrations.lastfm.never'
  | 'settings.integrations.lastfm.noActiveTrack'
  | 'settings.integrations.lastfm.nowPlaying.description'
  | 'settings.integrations.lastfm.nowPlaying.title'
  | 'settings.integrations.lastfm.scrobbling.description'
  | 'settings.integrations.lastfm.scrobbling.title'
  | 'settings.integrations.lastfm.status.connected'
  | 'settings.integrations.lastfm.status.error'
  | 'settings.integrations.lastfm.status.notConnected'
  | 'settings.integrations.lastfm.status.pending'
  | 'settings.integrations.lastfm.statusLabel'
  | 'settings.integrations.lastfm.title'
  | 'settings.integrations.mobile.description'
  | 'settings.integrations.mobile.title'
  | 'settings.integrations.accounts.cookieFallback'
  | 'settings.integrations.accounts.cookiePlaceholder'
  | 'settings.integrations.accounts.description.default'
  | 'settings.integrations.accounts.description.bilibili'
  | 'settings.integrations.accounts.loginAndSync'
  | 'settings.integrations.accounts.clickToLogin'
  | 'settings.integrations.accounts.logout'
  | 'settings.integrations.accounts.logoutBusy'
  | 'settings.integrations.accounts.manualSave'
  | 'settings.integrations.accounts.manualSaveBusy'
  | 'settings.integrations.accounts.check'
  | 'settings.integrations.accounts.checkBusy'
  | 'settings.integrations.accounts.loginBusy'
  | 'settings.integrations.accounts.loginMeta'
  | 'settings.integrations.accounts.loginStatus'
  | 'settings.integrations.accounts.soundcloudNote'
  | 'settings.integrations.accounts.osuNote'
  | 'settings.integrations.accounts.youtube.browser'
  | 'settings.integrations.accounts.youtube.browserNone'
  | 'settings.integrations.accounts.youtube.description'
  | 'settings.integrations.accounts.youtube.savedStatus'
  | 'settings.integrations.accounts.spotify.description'
  | 'settings.integrations.accounts.spotify.login'
  | 'settings.integrations.accounts.spotify.loginBusy'
  | 'settings.integrations.accounts.spotify.savedStatus'
  | 'settings.integrations.accountPanel.title'
  | 'settings.integrations.accountPanel.description'
  | 'settings.integrations.accountPanel.refreshAll'
  | 'settings.integrations.accountStartupRefresh.title'
  | 'settings.integrations.accountStartupRefresh.description'
  | 'settings.integrations.accountExpiryNotices.title'
  | 'settings.integrations.accountExpiryNotices.description'
  | 'settings.integrations.credentialPanel.title'
  | 'settings.integrations.credentialPanel.description'
  | 'settings.integrations.credentialPanel.expand'
  | 'settings.integrations.credentialPanel.collapse'
  | 'settings.integrations.smtcLyrics.title'
  | 'settings.integrations.smtcLyrics.description'
  | 'settings.integrations.spotifyAutoLaunchOfficialPlayer.title'
  | 'settings.integrations.spotifyAutoLaunchOfficialPlayer.description'
  | 'settings.integrations.networkProxy.title'
  | 'settings.integrations.networkProxy.description'
  | 'settings.integrations.networkProxy.mode'
  | 'settings.integrations.networkProxy.modeAria'
  | 'settings.integrations.networkProxy.mode.off'
  | 'settings.integrations.networkProxy.mode.system'
  | 'settings.integrations.networkProxy.mode.manual'
  | 'settings.integrations.networkProxy.manualUrl'
  | 'settings.integrations.networkProxy.manualPlaceholder'
  | 'settings.integrations.networkProxy.pacUrl'
  | 'settings.integrations.networkProxy.bypass'
  | 'settings.integrations.networkProxy.save'
  | 'settings.integrations.networkProxy.saveBusy'
  | 'settings.integrations.networkProxy.test'
  | 'settings.integrations.networkProxy.testBusy'
  | 'settings.integrations.networkProxy.note'
  | 'settings.library.network.description'
  | 'settings.library.network.title'
  | 'settings.library.networkSources.description'
  | 'settings.library.networkSources.title'
  | 'settings.library.networkPanel.applyMissingOnly'
  | 'settings.library.networkPanel.applySelected'
  | 'settings.library.networkPanel.appliedCount'
  | 'settings.library.networkPanel.artistField'
  | 'settings.library.networkPanel.artistSource'
  | 'settings.library.networkPanel.candidates'
  | 'settings.library.networkPanel.cover'
  | 'settings.library.networkPanel.embeddedCover'
  | 'settings.library.networkPanel.embeddedMetadata'
  | 'settings.library.networkPanel.kicker'
  | 'settings.library.networkPanel.localCover'
  | 'settings.library.networkPanel.missingCover'
  | 'settings.library.networkPanel.noCandidates'
  | 'settings.library.networkPanel.providerErrors'
  | 'settings.library.networkPanel.reject'
  | 'settings.library.networkPanel.repairMissing'
  | 'settings.library.networkPanel.repairThisTrack'
  | 'settings.library.networkPanel.scanComplete'
  | 'settings.library.networkPanel.scanMissing'
  | 'settings.library.networkPanel.scanDone'
  | 'settings.library.networkPanel.scanPreparing'
  | 'settings.library.networkPanel.scanProgress'
  | 'settings.library.networkPanel.scanRunning'
  | 'settings.library.networkPanel.showCandidates'
  | 'settings.library.networkPanel.title'
  | 'settings.library.networkPanel.titleField'
  | 'settings.library.networkPanel.trackId'
  | 'settings.library.networkPanel.trackNotFound'
  | 'settings.library.networkPanel.unknownArtist'
  | 'settings.library.networkPanel.untitled'
  | 'settings.eq.action.autoPreamp'
  | 'settings.eq.action.addFilter'
  | 'settings.eq.action.bypass'
  | 'settings.eq.action.delete'
  | 'settings.eq.action.deleteFilter'
  | 'settings.eq.action.duplicatePreset'
  | 'settings.eq.action.exportApoGraphicEqPreset'
  | 'settings.eq.action.exportApoPreset'
  | 'settings.eq.action.freqDown'
  | 'settings.eq.action.freqFineDown'
  | 'settings.eq.action.freqFineUp'
  | 'settings.eq.action.freqUp'
  | 'settings.eq.action.holdBypass'
  | 'settings.eq.action.holdOriginal'
  | 'settings.eq.action.hideAdvanced'
  | 'settings.eq.action.importPreset'
  | 'settings.eq.action.pasteApoPreset'
  | 'settings.eq.action.applyA'
  | 'settings.eq.action.applyB'
  | 'settings.eq.action.applySafePreamp'
  | 'settings.eq.action.applyProfile'
  | 'settings.eq.action.bindProfile'
  | 'settings.eq.action.deleteProfile'
  | 'settings.eq.action.overwrite'
  | 'settings.eq.action.redo'
  | 'settings.eq.action.resetBand'
  | 'settings.eq.action.resetAllGains'
  | 'settings.eq.action.resetChannelBalance'
  | 'settings.eq.action.resetDelaysOnly'
  | 'settings.eq.action.resetEq'
  | 'settings.eq.action.resetFrequencies'
  | 'settings.eq.action.resetMonitorTools'
  | 'settings.eq.action.resetSelected'
  | 'settings.eq.action.resetTrimsOnly'
  | 'settings.eq.action.revertUserPreset'
  | 'settings.eq.action.save'
  | 'settings.eq.action.saveAs'
  | 'settings.eq.action.saveProfile'
  | 'settings.eq.action.showAdvanced'
  | 'settings.eq.action.storeA'
  | 'settings.eq.action.storeB'
  | 'settings.eq.action.toggleBypassOff'
  | 'settings.eq.action.toggleBypassOn'
  | 'settings.eq.action.undo'
  | 'settings.eq.action.unlockFrequency'
  | 'settings.eq.ab.emptySlot'
  | 'settings.eq.ab.loudnessMatched'
  | 'settings.eq.ab.summary'
  | 'settings.eq.ab.title'
  | 'settings.eq.autoGain.adjustment'
  | 'settings.eq.autoGain.status'
  | 'settings.eq.autoGain.status.clipping'
  | 'settings.eq.autoGain.status.holding'
  | 'settings.eq.autoGain.status.idle'
  | 'settings.eq.autoGain.status.recovering'
  | 'settings.eq.autoGain.status.reducing'
  | 'settings.eq.autoGain.toggle'
  | 'settings.eq.room.active'
  | 'settings.eq.room.channelMode'
  | 'settings.eq.room.clear'
  | 'settings.eq.room.disable'
  | 'settings.eq.room.empty'
  | 'settings.eq.room.enable'
  | 'settings.eq.room.error'
  | 'settings.eq.room.error.invalidImpulse'
  | 'settings.eq.room.error.invalidWav'
  | 'settings.eq.room.error.missingFile'
  | 'settings.eq.room.error.missingIr'
  | 'settings.eq.room.error.tooLong'
  | 'settings.eq.room.import'
  | 'settings.eq.room.ir'
  | 'settings.eq.room.loaded'
  | 'settings.eq.room.sampleRate'
  | 'settings.eq.room.short'
  | 'settings.eq.room.tapCount'
  | 'settings.eq.room.title'
  | 'settings.eq.room.trim'
  | 'settings.eq.analyzer.overlayAria'
  | 'settings.eq.analyzer.input'
  | 'settings.eq.analyzer.mode'
  | 'settings.eq.analyzer.postEq'
  | 'settings.eq.analyzer.status'
  | 'settings.eq.analyzer.status.live'
  | 'settings.eq.analyzer.status.noSignal'
  | 'settings.eq.analyzer.status.off'
  | 'settings.eq.analyzer.status.priming'
  | 'settings.eq.analyzer.toggle'
  | 'settings.eq.band.fallback'
  | 'settings.eq.band.frequency'
  | 'settings.eq.band.frequencyStepper'
  | 'settings.eq.band.frequencySnapped'
  | 'settings.eq.band.frequencyUnlocked'
  | 'settings.eq.band.gain'
  | 'settings.eq.band.gainFixed'
  | 'settings.eq.band.gainStepper'
  | 'settings.eq.band.bypassed'
  | 'settings.eq.band.console'
  | 'settings.eq.band.enabled'
  | 'settings.eq.band.enabledShort'
  | 'settings.eq.band.filters'
  | 'settings.eq.band.filterStack'
  | 'settings.eq.band.filterType'
  | 'settings.eq.band.inspector'
  | 'settings.eq.band.matrix'
  | 'settings.eq.band.modeFree'
  | 'settings.eq.band.modeStandard'
  | 'settings.eq.band.q'
  | 'settings.eq.band.qPresetNarrow'
  | 'settings.eq.band.qPresetNormal'
  | 'settings.eq.band.qPresets'
  | 'settings.eq.band.qPresetWide'
  | 'settings.eq.band.readoutsAria'
  | 'settings.eq.bitPerfect.channelDisabled'
  | 'settings.eq.bitPerfect.disabled'
  | 'settings.eq.bitPerfect.readyPath'
  | 'settings.eq.bitPerfect.sourceBoth'
  | 'settings.eq.bitPerfect.sourceChannel'
  | 'settings.eq.bitPerfect.sourceEq'
  | 'settings.eq.bitPerfect.sourceRoom'
  | 'settings.eq.channel.active'
  | 'settings.eq.channel.balance'
  | 'settings.eq.channel.bypassed'
  | 'settings.eq.channel.center'
  | 'settings.eq.channel.calibrationMode'
  | 'settings.eq.channel.constantPower'
  | 'settings.eq.channel.description'
  | 'settings.eq.channel.dsp'
  | 'settings.eq.channel.effectiveLeft'
  | 'settings.eq.channel.effectiveRight'
  | 'settings.eq.channel.group.balance'
  | 'settings.eq.channel.group.gainTrim'
  | 'settings.eq.channel.group.monitorTools'
  | 'settings.eq.channel.group.phaseTools'
  | 'settings.eq.channel.group.timing'
  | 'settings.eq.channel.invertLeft'
  | 'settings.eq.channel.invertRight'
  | 'settings.eq.channel.leftDelay'
  | 'settings.eq.channel.leftGain'
  | 'settings.eq.channel.leftTotal'
  | 'settings.eq.channel.mono.left'
  | 'settings.eq.channel.mono.off'
  | 'settings.eq.channel.mono.right'
  | 'settings.eq.channel.mono.sum'
  | 'settings.eq.channel.monoMode'
  | 'settings.eq.channel.quick.leftSolo'
  | 'settings.eq.channel.quick.monoCheck'
  | 'settings.eq.channel.quick.phaseCheck'
  | 'settings.eq.channel.quick.rightSolo'
  | 'settings.eq.channel.quick.swapCheck'
  | 'settings.eq.channel.quickTools'
  | 'settings.eq.channel.rightDelay'
  | 'settings.eq.channel.rightGain'
  | 'settings.eq.channel.rightTotal'
  | 'settings.eq.channel.swap'
  | 'settings.eq.channel.title'
  | 'settings.eq.channel.wizard.apply'
  | 'settings.eq.channel.wizard.clear'
  | 'settings.eq.channel.wizard.empty'
  | 'settings.eq.channel.wizard.imageLeft'
  | 'settings.eq.channel.wizard.imageRight'
  | 'settings.eq.channel.wizard.leftDistance'
  | 'settings.eq.channel.wizard.leftLouder'
  | 'settings.eq.channel.wizard.leftSpl'
  | 'settings.eq.channel.wizard.monitor'
  | 'settings.eq.channel.wizard.nudge'
  | 'settings.eq.channel.wizard.previewCenter'
  | 'settings.eq.channel.wizard.previewLeft'
  | 'settings.eq.channel.wizard.previewRight'
  | 'settings.eq.channel.wizard.ready'
  | 'settings.eq.channel.wizard.rightDistance'
  | 'settings.eq.channel.wizard.rightLouder'
  | 'settings.eq.channel.wizard.rightSpl'
  | 'settings.eq.channel.wizard.title'
  | 'settings.eq.comfort.direct'
  | 'settings.eq.comfort.directDetail'
  | 'settings.eq.comfort.risk'
  | 'settings.eq.comfort.riskDetail'
  | 'settings.eq.comfort.tuned'
  | 'settings.eq.comfort.tunedDetail'
  | 'settings.eq.curve.aria'
  | 'settings.eq.curve.dragBand'
  | 'settings.eq.curve.fineEdit'
  | 'settings.eq.curve.freeFrequency'
  | 'settings.eq.curve.snapped'
  | 'settings.eq.error.bridgeChannelBalance'
  | 'settings.eq.error.bridgeControlEq'
  | 'settings.eq.error.bridgeDeletePreset'
  | 'settings.eq.error.bridgeSavePreset'
  | 'settings.eq.error.presetName'
  | 'settings.eq.error.profileName'
  | 'settings.eq.error.profileTarget'
  | 'settings.eq.export.successApo'
  | 'settings.eq.export.successGraphicEq'
  | 'settings.eq.export.successPreset'
  | 'settings.eq.import.filters'
  | 'settings.eq.import.filtersValue'
  | 'settings.eq.import.filterPreview'
  | 'settings.eq.import.filterEnabledAria'
  | 'settings.eq.import.filterFrequencyAria'
  | 'settings.eq.import.filterGainAria'
  | 'settings.eq.import.filterQAria'
  | 'settings.eq.import.filterTypeAria'
  | 'settings.eq.import.graphicEq'
  | 'settings.eq.import.estimatedPeak'
  | 'settings.eq.import.includes'
  | 'settings.eq.import.includesValue'
  | 'settings.eq.import.maxBoost'
  | 'settings.eq.import.maxCut'
  | 'settings.eq.import.apoDirectives'
  | 'settings.eq.import.apoDirectiveDetails'
  | 'settings.eq.import.apoDirectivesValue'
  | 'settings.eq.import.bandwidthFilters'
  | 'settings.eq.import.bandwidthFiltersValue'
  | 'settings.eq.import.compatibility'
  | 'settings.eq.import.compatibility.adjusted'
  | 'settings.eq.import.compatibility.clean'
  | 'settings.eq.import.compatibility.partial'
  | 'settings.eq.import.moreFilters'
  | 'settings.eq.import.noFilters'
  | 'settings.eq.import.preamp'
  | 'settings.eq.import.preampAria'
  | 'settings.eq.import.safePreamp'
  | 'settings.eq.import.safetyDetail'
  | 'settings.eq.import.safetyNeedsHeadroom'
  | 'settings.eq.import.safetyOk'
  | 'settings.eq.import.safetyTitle'
  | 'settings.eq.import.audition'
  | 'settings.eq.import.auditionPresetName'
  | 'settings.eq.import.restoreAudition'
  | 'settings.eq.import.clearPaste'
  | 'settings.eq.import.applyPreview'
  | 'settings.eq.import.cancelPreview'
  | 'settings.eq.import.pasteDefaultName'
  | 'settings.eq.import.pasteEmpty'
  | 'settings.eq.import.pasteFileName'
  | 'settings.eq.import.pasteIncludeWarning'
  | 'settings.eq.import.pasteTitle'
  | 'settings.eq.import.previewPaste'
  | 'settings.eq.import.previewTitle'
  | 'settings.eq.import.reportTitle'
  | 'settings.eq.import.source'
  | 'settings.eq.import.sourceApo'
  | 'settings.eq.import.sourceEcho'
  | 'settings.eq.import.updateAudition'
  | 'settings.eq.import.useSafePreamp'
  | 'settings.eq.filter.highShelf'
  | 'settings.eq.filter.highPass'
  | 'settings.eq.filter.lowShelf'
  | 'settings.eq.filter.lowPass'
  | 'settings.eq.filter.notch'
  | 'settings.eq.filter.peaking'
  | 'settings.eq.headphoneCorrection.ab'
  | 'settings.eq.headphoneCorrection.compareCorrected'
  | 'settings.eq.headphoneCorrection.compareOriginal'
  | 'settings.eq.headphoneCorrection.convert'
  | 'settings.eq.headphoneCorrection.customName'
  | 'settings.eq.headphoneCorrection.lockAria'
  | 'settings.eq.headphoneCorrection.lockDetail'
  | 'settings.eq.headphoneCorrection.lockedError'
  | 'settings.eq.headphoneCorrection.managed'
  | 'settings.eq.level.clips'
  | 'settings.eq.level.estimatedOutputPeak'
  | 'settings.eq.level.headroom'
  | 'settings.eq.level.inputPeak'
  | 'settings.eq.level.inputRms'
  | 'settings.eq.level.sourceEstimate'
  | 'settings.eq.preamp.aria'
  | 'settings.eq.preamp.inputSafety'
  | 'settings.eq.preamp.maxBoost'
  | 'settings.eq.preamp.metricsAria'
  | 'settings.eq.preamp.recommended'
  | 'settings.eq.preamp.safeHeadroom'
  | 'settings.eq.signal.armed'
  | 'settings.eq.signal.bitPerfectOutput'
  | 'settings.eq.signal.dspActive'
  | 'settings.eq.signal.dspOutput'
  | 'settings.eq.signal.input'
  | 'settings.eq.signal.limiter'
  | 'settings.eq.signal.output'
  | 'settings.eq.signal.peq'
  | 'settings.eq.signal.preamp'
  | 'settings.eq.signal.protecting'
  | 'settings.eq.signal.title'
  | 'settings.eq.simpleAction.customPresetName'
  | 'settings.eq.simpleAction.lastTweak'
  | 'settings.eq.simpleAction.nextVibe'
  | 'settings.eq.simpleAction.nextVibeDetail'
  | 'settings.eq.simpleAction.savedPresetName'
  | 'settings.eq.simpleAction.saveVibe'
  | 'settings.eq.simpleAction.saveVibeDetail'
  | 'settings.eq.simpleInsight.amount'
  | 'settings.eq.simpleInsight.aria'
  | 'settings.eq.simpleInsight.custom'
  | 'settings.eq.simpleInsight.mainChange'
  | 'settings.eq.simpleInsight.ready'
  | 'settings.eq.simpleInsight.vibe'
  | 'settings.eq.simpleSafety.action'
  | 'settings.eq.simpleSafety.aria'
  | 'settings.eq.simpleSafety.risk'
  | 'settings.eq.simpleSafety.riskDetail'
  | 'settings.eq.simpleSafety.safe'
  | 'settings.eq.simpleSafety.safeDetail'
  | 'settings.eq.simpleTone.air'
  | 'settings.eq.simpleTone.airDetail'
  | 'settings.eq.simpleTone.amount'
  | 'settings.eq.simpleTone.amountAria'
  | 'settings.eq.simpleTone.aria'
  | 'settings.eq.simpleTone.bass'
  | 'settings.eq.simpleTone.bassDetail'
  | 'settings.eq.simpleTone.flat'
  | 'settings.eq.simpleTone.flatDetail'
  | 'settings.eq.simpleTone.less'
  | 'settings.eq.simpleTone.more'
  | 'settings.eq.simpleTone.vocal'
  | 'settings.eq.simpleTone.vocalDetail'
  | 'settings.eq.simpleTone.warm'
  | 'settings.eq.simpleTone.warmDetail'
  | 'settings.eq.simpleZone.air'
  | 'settings.eq.simpleZone.airDetail'
  | 'settings.eq.simpleZone.applyAria'
  | 'settings.eq.simpleZone.aria'
  | 'settings.eq.simpleZone.low'
  | 'settings.eq.simpleZone.lowDetail'
  | 'settings.eq.simpleZone.neutral'
  | 'settings.eq.simpleZone.vocal'
  | 'settings.eq.simpleZone.vocalDetail'
  | 'settings.eq.routing.action.armHeadroom6'
  | 'settings.eq.routing.action.nativeDirect'
  | 'settings.eq.routing.armed'
  | 'settings.eq.routing.dspPath'
  | 'settings.eq.routing.dspPathDetail'
  | 'settings.eq.routing.headroomActiveDetail'
  | 'settings.eq.routing.headroomStandby'
  | 'settings.eq.routing.headroomStandbyDetail'
  | 'settings.eq.routing.modules'
  | 'settings.eq.routing.modulesActiveDetail'
  | 'settings.eq.routing.modulesBypassed'
  | 'settings.eq.routing.modulesBypassedDetail'
  | 'settings.eq.routing.nativeBypassComfort'
  | 'settings.eq.routing.nativeDirect'
  | 'settings.eq.routing.nativeDirectDetail'
  | 'settings.eq.routing.nativeNoGainDetail'
  | 'settings.eq.routing.playbackPath'
  | 'settings.eq.routing.protectActive'
  | 'settings.eq.routing.protectActiveDetail'
  | 'settings.eq.routing.safety'
  | 'settings.eq.headroom.dsp'
  | 'settings.eq.headroom.nativeBypassNote'
  | 'settings.eq.headroom.presetsAria'
  | 'settings.eq.profile.bound'
  | 'settings.eq.profile.empty'
  | 'settings.eq.profile.nameAria'
  | 'settings.eq.profile.namePlaceholder'
  | 'settings.eq.profile.noOutput'
  | 'settings.eq.profile.selectorAria'
  | 'settings.eq.profile.title'
  | 'settings.eq.profile.unbound'
  | 'settings.eq.preset.builtIn'
  | 'settings.eq.preset.approximation'
  | 'settings.eq.preset.copyName'
  | 'settings.eq.preset.filter.all'
  | 'settings.eq.preset.filter.builtIn'
  | 'settings.eq.preset.filter.genre'
  | 'settings.eq.preset.filter.target'
  | 'settings.eq.preset.filter.user'
  | 'settings.eq.preset.filter.utility'
  | 'settings.eq.preset.filterAria'
  | 'settings.eq.preset.meta.approximationCaution'
  | 'settings.eq.preset.meta.genrePurpose'
  | 'settings.eq.preset.meta.genreScenario'
  | 'settings.eq.preset.meta.targetPurpose'
  | 'settings.eq.preset.meta.targetScenario'
  | 'settings.eq.preset.meta.tasteCaution'
  | 'settings.eq.preset.meta.type.animeJpop'
  | 'settings.eq.preset.meta.type.bassBoost'
  | 'settings.eq.preset.meta.type.bkRoomCurve'
  | 'settings.eq.preset.meta.type.broadcastVoice'
  | 'settings.eq.preset.meta.type.bluetoothSpeakerCleanup'
  | 'settings.eq.preset.meta.type.acousticSilk'
  | 'settings.eq.preset.meta.type.classicSmiley'
  | 'settings.eq.preset.meta.type.classical'
  | 'settings.eq.preset.meta.type.cinemaOrchestra'
  | 'settings.eq.preset.meta.type.cityPop'
  | 'settings.eq.preset.meta.type.diffuseField'
  | 'settings.eq.preset.meta.type.femaleVocalAir'
  | 'settings.eq.preset.meta.type.flat'
  | 'settings.eq.preset.meta.type.harmanInEar'
  | 'settings.eq.preset.meta.type.harmanTarget'
  | 'settings.eq.preset.meta.type.headphoneNotch'
  | 'settings.eq.preset.meta.type.headphoneWarm'
  | 'settings.eq.preset.meta.type.liveHouse'
  | 'settings.eq.preset.meta.type.lofiDusk'
  | 'settings.eq.preset.meta.type.loudness'
  | 'settings.eq.preset.meta.type.night'
  | 'settings.eq.preset.meta.type.pianoRoom'
  | 'settings.eq.preset.meta.type.rock'
  | 'settings.eq.preset.meta.type.sibilanceTamer'
  | 'settings.eq.preset.meta.type.studioNeutral'
  | 'settings.eq.preset.meta.type.subCleanup'
  | 'settings.eq.preset.meta.type.subsonicFilter'
  | 'settings.eq.preset.meta.type.trebleSparkle'
  | 'settings.eq.preset.meta.type.vinylWarmth'
  | 'settings.eq.preset.meta.type.vocalClear'
  | 'settings.eq.preset.meta.type.vocalDeEss'
  | 'settings.eq.preset.meta.utilityCaution'
  | 'settings.eq.preset.meta.utilityPurpose'
  | 'settings.eq.preset.meta.utilityScenario'
  | 'settings.eq.preset.modified'
  | 'settings.eq.preset.nameAria'
  | 'settings.eq.preset.readonly'
  | 'settings.eq.preset.savePlaceholder'
  | 'settings.eq.preset.searchAria'
  | 'settings.eq.preset.searchPlaceholder'
  | 'settings.eq.preset.selectorAria'
  | 'settings.eq.preset.user'
  | 'settings.eq.mode.aria'
  | 'settings.eq.mode.current'
  | 'settings.eq.mode.pro'
  | 'settings.eq.mode.simple'
  | 'settings.eq.section.channel'
  | 'settings.eq.section.compare'
  | 'settings.eq.state.eqDisabled'
  | 'settings.eq.state.eqEnabled'
  | 'settings.eq.status.bitPerfect'
  | 'settings.eq.status.clippingRisk'
  | 'settings.eq.status.eq'
  | 'settings.eq.status.estimatedPeak'
  | 'settings.eq.status.headroom'
  | 'settings.eq.status.preamp'
  | 'settings.eq.status.preset'
  | 'settings.eq.status.processor'
  | 'settings.eq.status.realtimeIir'
  | 'settings.eq.status.safe'
  | 'settings.eq.status.safeHeadroomShort'
  | 'settings.eq.status.warning'
  | 'settings.eq.subtitle'
  | 'settings.eq.title'
  | 'settings.eq.warning.channelClipping'
  | 'settings.eq.warning.lowerPreamp'
  | 'settings.nav.about.description'
  | 'settings.nav.about.label'
  | 'settings.nav.appearance.description'
  | 'settings.nav.appearance.label'
  | 'settings.nav.danger.description'
  | 'settings.nav.danger.label'
  | 'settings.nav.eq.description'
  | 'settings.nav.eq.label'
  | 'settings.nav.general.description'
  | 'settings.nav.general.label'
  | 'settings.nav.integrations.description'
  | 'settings.nav.integrations.label'
  | 'settings.nav.library.description'
  | 'settings.nav.library.label'
  | 'settings.nav.playback.description'
  | 'settings.nav.playback.label'
  | 'settings.nav.plugins.description'
  | 'settings.nav.plugins.label'
  | 'settings.plugins.card.title'
  | 'settings.plugins.card.description'
  | 'settings.plugins.meta.runtime'
  | 'settings.plugins.meta.runtimeValue'
  | 'settings.plugins.meta.defaultState'
  | 'settings.plugins.meta.defaultStateValue'
  | 'settings.plugins.meta.permissions'
  | 'settings.plugins.meta.permissionsValue'
  | 'settings.plugins.meta.playbackSafety'
  | 'settings.plugins.meta.playbackSafetyValue'
  | 'settings.plugins.action.openPage'
  | 'settings.plugins.action.openDirectory'
  | 'settings.plugins.action.createExample'
  | 'settings.plugins.action.openDocs'
  | 'settings.plugins.note'
  | 'settings.remote.albumMerge.action.apply'
  | 'settings.remote.albumMerge.action.applying'
  | 'settings.remote.albumMerge.action.scan'
  | 'settings.remote.albumMerge.action.scanning'
  | 'settings.remote.albumMerge.aria'
  | 'settings.remote.albumMerge.description'
  | 'settings.remote.albumMerge.groupAria'
  | 'settings.remote.albumMerge.option.conservative'
  | 'settings.remote.albumMerge.option.conservative.description'
  | 'settings.remote.albumMerge.option.standard'
  | 'settings.remote.albumMerge.option.standard.description'
  | 'settings.remote.albumMerge.pending'
  | 'settings.remote.albumMerge.stat.current'
  | 'settings.remote.albumMerge.stat.target'
  | 'settings.remote.albumMerge.stat.tracks'
  | 'settings.remote.albumMerge.title'
  | 'settings.remote.coverPerformance.aria'
  | 'settings.remote.coverPerformance.description'
  | 'settings.remote.coverPerformance.groupAria'
  | 'settings.remote.coverPerformance.option.aggressive'
  | 'settings.remote.coverPerformance.option.aggressive.description'
  | 'settings.remote.coverPerformance.option.balanced'
  | 'settings.remote.coverPerformance.option.balanced.description'
  | 'settings.remote.coverPerformance.option.lan'
  | 'settings.remote.coverPerformance.option.lan.description'
  | 'settings.remote.coverPerformance.option.low'
  | 'settings.remote.coverPerformance.option.low.description'
  | 'settings.remote.coverPerformance.title'
  | 'settings.remote.guardrail.aria'
  | 'settings.remote.guardrail.description'
  | 'settings.remote.guardrail.title'
  | 'settings.remote.hero.description'
  | 'settings.remote.hero.summary'
  | 'settings.remote.hero.title'
  | 'settings.nav.remote.description'
  | 'settings.nav.remote.label'
  | 'settings.nav.shortcuts.description'
  | 'settings.nav.shortcuts.label'
  | 'settings.playback.audioStatus.description'
  | 'settings.playback.audioStatus.title'
  | 'settings.playback.advancedPanel.action.collapse'
  | 'settings.playback.advancedPanel.action.expand'
  | 'settings.playback.advancedPanel.description'
  | 'settings.playback.advancedPanel.memory'
  | 'settings.playback.advancedPanel.title'
  | 'settings.playback.asioNativeDsd.description'
  | 'settings.playback.asioNativeDsd.title'
  | 'settings.playback.automix.description'
  | 'settings.playback.automix.title'
  | 'settings.playback.dsdDop.description'
  | 'settings.playback.dsdDop.requiresAsio'
  | 'settings.playback.dsdDop.title'
  | 'settings.playback.exportFormat.description'
  | 'settings.playback.exportFormat.title'
  | 'settings.playback.fixedVolume.description'
  | 'settings.playback.fixedVolume.status.fixed'
  | 'settings.playback.fixedVolume.title'
  | 'settings.playback.gapless.description'
  | 'settings.playback.gapless.title'
  | 'settings.playback.transportFade.curve.equalPower'
  | 'settings.playback.transportFade.curve.linear'
  | 'settings.playback.transportFade.curve.smooth'
  | 'settings.playback.transportFade.description'
  | 'settings.playback.transportFade.field.curve'
  | 'settings.playback.transportFade.field.duration'
  | 'settings.playback.transportFade.field.fadeIn'
  | 'settings.playback.transportFade.field.fadeOut'
  | 'settings.playback.transportFade.status.disabled'
  | 'settings.playback.transportFade.status.enabled'
  | 'settings.playback.transportFade.title'
  | 'settings.playback.issueDiagnostics.description'
  | 'settings.playback.issueDiagnostics.title'
  | 'settings.playback.juceOutput.description'
  | 'settings.playback.juceOutput.title'
  | 'settings.playback.miniPlayer.action.hide'
  | 'settings.playback.miniPlayer.action.show'
  | 'settings.playback.miniPlayer.autoHideNote'
  | 'settings.playback.miniPlayer.description'
  | 'settings.playback.miniPlayer.status.hidden'
  | 'settings.playback.miniPlayer.status.visible'
  | 'settings.playback.miniPlayer.title'
  | 'settings.playback.monoAudio.description'
  | 'settings.playback.monoAudio.title'
  | 'settings.playback.nativeDecode.description'
  | 'settings.playback.nativeDecode.title'
  | 'settings.playback.outputDevice.description'
  | 'settings.playback.outputDevice.empty'
  | 'settings.playback.outputDevice.title'
  | 'settings.playback.outputMode.asio'
  | 'settings.playback.outputMode.description'
  | 'settings.playback.outputMode.exclusive'
  | 'settings.playback.outputMode.shared'
  | 'settings.playback.outputMode.system'
  | 'settings.playback.outputMode.title'
  | 'settings.playback.hqplayer.defaultBackend.ask'
  | 'settings.playback.hqplayer.defaultBackend.echoNative'
  | 'settings.playback.hqplayer.defaultBackend.hqplayer'
  | 'settings.playback.hqplayer.description'
  | 'settings.playback.hqplayer.enable'
  | 'settings.playback.hqplayer.field.defaultBackend'
  | 'settings.playback.hqplayer.field.endpoint'
  | 'settings.playback.hqplayer.field.lastChecked'
  | 'settings.playback.hqplayer.field.status'
  | 'settings.playback.hqplayer.host'
  | 'settings.playback.hqplayer.mediaServer'
  | 'settings.playback.hqplayer.mode.localDesktop'
  | 'settings.playback.hqplayer.mode.remote'
  | 'settings.playback.hqplayer.note'
  | 'settings.playback.hqplayer.port'
  | 'settings.playback.hqplayer.profileName'
  | 'settings.playback.hqplayer.result.failed'
  | 'settings.playback.hqplayer.result.ok'
  | 'settings.playback.hqplayer.save'
  | 'settings.playback.hqplayer.saving'
  | 'settings.playback.hqplayer.status.available'
  | 'settings.playback.hqplayer.status.checking'
  | 'settings.playback.hqplayer.status.disabled'
  | 'settings.playback.hqplayer.status.notConfigured'
  | 'settings.playback.hqplayer.status.unavailable'
  | 'settings.playback.hqplayer.test'
  | 'settings.playback.hqplayer.testing'
  | 'settings.playback.hqplayer.title'
  | 'settings.playback.sharedBackend.description'
  | 'settings.playback.sharedBackend.alsa'
  | 'settings.playback.sharedBackend.auto'
  | 'settings.playback.sharedBackend.directSound'
  | 'settings.playback.sharedBackend.linuxDescription'
  | 'settings.playback.sharedBackend.title'
  | 'settings.playback.sharedBackend.wasapi'
  | 'settings.playback.resetEngine.action'
  | 'settings.playback.resetEngine.busy'
  | 'settings.playback.resetEngine.description'
  | 'settings.playback.resetEngine.done'
  | 'settings.playback.resetEngine.title'
  | 'settings.playback.segmentLoop.description'
  | 'settings.playback.segmentLoop.title'
  | 'settings.playback.replayGain.action.advanced'
  | 'settings.playback.replayGain.action.analyzeMissing'
  | 'settings.playback.replayGain.action.analyzing'
  | 'settings.playback.replayGain.description'
  | 'settings.playback.replayGain.error'
  | 'settings.playback.replayGain.field.applied'
  | 'settings.playback.replayGain.field.mode'
  | 'settings.playback.replayGain.field.preventClipping'
  | 'settings.playback.replayGain.field.preamp'
  | 'settings.playback.replayGain.field.progress'
  | 'settings.playback.replayGain.field.target'
  | 'settings.playback.replayGain.mode.album'
  | 'settings.playback.replayGain.mode.off'
  | 'settings.playback.replayGain.mode.track'
  | 'settings.playback.replayGain.notRun'
  | 'settings.playback.replayGain.preset.quiet'
  | 'settings.playback.replayGain.preset.standard'
  | 'settings.playback.replayGain.status.disabled'
  | 'settings.playback.replayGain.status.enabled'
  | 'settings.playback.replayGain.title'
  | 'settings.playback.replayGain.toggle.analyzeOnPlay'
  | 'settings.playback.replayGain.toggle.analyzeOnScan'
  | 'settings.playback.replayGain.toggle.preventClipping'
  | 'settings.playback.status.off'
  | 'settings.playback.status.on'
  | 'settings.playback.troubleshooting.description'
  | 'settings.playback.troubleshooting.hardAction'
  | 'settings.playback.troubleshooting.hardBusy'
  | 'settings.playback.troubleshooting.hardConfirm'
  | 'settings.playback.troubleshooting.hardDone'
  | 'settings.playback.troubleshooting.softAction'
  | 'settings.playback.troubleshooting.softBusy'
  | 'settings.playback.troubleshooting.softDone'
  | 'settings.playback.troubleshooting.title'
  | 'settings.playback.speedMode.description'
  | 'settings.playback.speedMode.title'
  | 'settings.playback.stability.action.copied'
  | 'settings.playback.stability.action.copy'
  | 'settings.playback.stability.action.refresh'
  | 'settings.playback.stability.error.desktopBridgeUnavailable'
  | 'settings.playback.stability.field.lastSharedStabilityRecoveryAt'
  | 'settings.playback.stability.field.lastWatchdogRecoveryTime'
  | 'settings.playback.stability.field.nativeBufferedFrames'
  | 'settings.playback.stability.field.nativeBufferedMs'
  | 'settings.playback.stability.field.nativeDeviceBufferFrames'
  | 'settings.playback.stability.field.nativeFifoCapacityFrames'
  | 'settings.playback.stability.field.nativeStartupPrebufferFrames'
  | 'settings.playback.stability.field.nativeUnderrunCallbacks'
  | 'settings.playback.stability.field.nativeUnderrunFrames'
  | 'settings.playback.stability.field.recentWatchdogRecoveryCount'
  | 'settings.playback.stability.field.sharedStabilityTier'
  | 'settings.playback.stability.field.watchdogStatus'
  | 'settings.playback.stability.title'
  | 'settings.playback.stability.value.unknown'
  | 'settings.playback.wireless.description'
  | 'settings.playback.wireless.title'
  | 'settings.shortcuts.action.clear'
  | 'settings.shortcuts.action.bossKey.description'
  | 'settings.shortcuts.action.bossKey.title'
  | 'settings.shortcuts.action.nextTrack.description'
  | 'settings.shortcuts.action.nextTrack.title'
  | 'settings.shortcuts.action.openAudioSettings.description'
  | 'settings.shortcuts.action.openAudioSettings.title'
  | 'settings.shortcuts.action.openLyricsSettings.description'
  | 'settings.shortcuts.action.openLyricsSettings.title'
  | 'settings.shortcuts.action.openMvSettings.description'
  | 'settings.shortcuts.action.openMvSettings.title'
  | 'settings.shortcuts.action.locateCurrentTrack.description'
  | 'settings.shortcuts.action.locateCurrentTrack.title'
  | 'settings.shortcuts.action.playPause.description'
  | 'settings.shortcuts.action.playPause.title'
  | 'settings.shortcuts.action.previousTrack.description'
  | 'settings.shortcuts.action.previousTrack.title'
  | 'settings.shortcuts.action.record'
  | 'settings.shortcuts.action.restoreRecommended'
  | 'settings.shortcuts.action.seekBackward.description'
  | 'settings.shortcuts.action.seekBackward.title'
  | 'settings.shortcuts.action.seekForward.description'
  | 'settings.shortcuts.action.seekForward.title'
  | 'settings.shortcuts.action.showMainWindow.description'
  | 'settings.shortcuts.action.showMainWindow.title'
  | 'settings.shortcuts.action.speedDown.description'
  | 'settings.shortcuts.action.speedDown.title'
  | 'settings.shortcuts.action.speedUp.description'
  | 'settings.shortcuts.action.speedUp.title'
  | 'settings.shortcuts.action.stop.description'
  | 'settings.shortcuts.action.stop.title'
  | 'settings.shortcuts.action.toggleDesktopLyrics.description'
  | 'settings.shortcuts.action.toggleDesktopLyrics.title'
  | 'settings.shortcuts.action.toggleDesktopLyricsLock.description'
  | 'settings.shortcuts.action.toggleDesktopLyricsLock.title'
  | 'settings.shortcuts.action.volumeDown.description'
  | 'settings.shortcuts.action.volumeDown.title'
  | 'settings.shortcuts.action.volumeUp.description'
  | 'settings.shortcuts.action.volumeUp.title'
  | 'settings.shortcuts.column.function'
  | 'settings.shortcuts.column.global'
  | 'settings.shortcuts.column.local'
  | 'settings.shortcuts.description'
  | 'settings.shortcuts.empty'
  | 'settings.shortcuts.localUnavailable'
  | 'settings.shortcuts.message.duplicate'
  | 'settings.shortcuts.message.empty'
  | 'settings.shortcuts.message.invalid'
  | 'settings.shortcuts.message.safe'
  | 'settings.shortcuts.message.unavailable'
  | 'settings.shortcuts.message.unsafe'
  | 'settings.shortcuts.note'
  | 'settings.shortcuts.recording'
  | 'settings.shortcuts.scope.global'
  | 'settings.shortcuts.scope.local'
  | 'settings.shortcuts.title'
  | 'settings.remote.library.description'
  | 'settings.remote.library.title'
  | 'segmentLoop.action.clear'
  | 'segmentLoop.action.deleteBookmark'
  | 'segmentLoop.action.deleteBookmarkTitle'
  | 'segmentLoop.action.loopBookmark'
  | 'segmentLoop.action.loopBookmarkTitle'
  | 'segmentLoop.action.saveBookmark'
  | 'segmentLoop.action.setA'
  | 'segmentLoop.action.setB'
  | 'segmentLoop.action.toggle'
  | 'segmentLoop.action.toggleTitle'
  | 'segmentLoop.aria.bookmarks'
  | 'segmentLoop.aria.panel'
  | 'segmentLoop.empty'
  | 'segmentLoop.notSet'
  | 'spotifyPlayback.error.noDevice'
  | 'spotifyPlayback.error.noDrmKeysystem';

type TranslationMap = Record<TranslationKey, string>;

const zhCN: TranslationMap = {
  'albumTagEditor.action.applyToForm': '应用到表单',
  'albumTagEditor.action.cancel': '取消',
  'albumTagEditor.action.chooseCover': '选择封面',
  'albumTagEditor.action.close': '关闭编辑标签',
  'albumTagEditor.action.deleteAlbum': '删除专辑',
  'albumTagEditor.action.loadEmbedded': '重读嵌入标签',
  'albumTagEditor.action.loading': '读取中',
  'albumTagEditor.action.loadNetwork': '从网络加载',
  'albumTagEditor.action.openInExplorer': '从资源管理器打开',
  'albumTagEditor.action.saveTags': '保存标签',
  'albumTagEditor.action.saving': '保存中',
  'albumTagEditor.action.searchCandidates': '搜索候选',
  'albumTagEditor.action.searching': '搜索中',
  'albumTagEditor.albumSummary': '{count} 首 / {duration}',
  'albumTagEditor.cover.embeddedSuffix': ' / 已从内嵌标签重新载入封面',
  'albumTagEditor.cover.localSuffix': ' / 本地封面：{path}',
  'albumTagEditor.cover.networkSuffix': ' / 网络封面将在保存时下载并写入',
  'albumTagEditor.currentAlbum': '当前专辑',
  'albumTagEditor.currentAlbumAria': '当前专辑',
  'albumTagEditor.discard.continue': '继续编辑',
  'albumTagEditor.discard.discard': '丢弃更改',
  'albumTagEditor.discard.prompt': '有未保存更改，确认关闭并丢弃吗？',
  'albumTagEditor.duration.hoursMinutes': '{hours} 小时 {minutes} 分钟',
  'albumTagEditor.duration.minutes': '{minutes} 分钟',
  'albumTagEditor.duration.unknown': '未知时长',
  'albumTagEditor.error.chooseCoverUnsupported': '当前运行环境不支持选择封面。',
  'albumTagEditor.error.embeddedUnsupported': '当前运行环境不支持读取内嵌标签。',
  'albumTagEditor.error.fixYearBeforeSave': '请先修正年份，再保存标签。',
  'albumTagEditor.error.networkTemporary': '网络来源暂时不可用，请稍后再试。',
  'albumTagEditor.error.networkUnsupported': '当前运行环境不支持网络标签搜索。',
  'albumTagEditor.error.noReadableTrack': '这张专辑没有可读取标签的歌曲。',
  'albumTagEditor.error.openFolderUnsupported': '当前运行环境不支持打开资源管理器。',
  'albumTagEditor.error.positiveInteger': '{label}必须是正整数或留空',
  'albumTagEditor.error.readTracksUnsupported': '当前运行环境不支持读取专辑曲目。',
  'albumTagEditor.field.album': '专辑',
  'albumTagEditor.field.albumArtist': '专辑艺术家',
  'albumTagEditor.field.cover': '封面',
  'albumTagEditor.field.genre': '流派',
  'albumTagEditor.field.year': '年份',
  'albumTagEditor.message.appliedNetwork': '已应用到表单，点击保存后才会写入专辑内歌曲。',
  'albumTagEditor.message.noNetworkTags': '没有找到合适的网络标签。',
  'albumTagEditor.message.searchingNetwork': '正在搜索网络标签...',
  'albumTagEditor.network.aria': '网络候选对比',
  'albumTagEditor.network.column.candidate': '候选',
  'albumTagEditor.network.column.current': '当前',
  'albumTagEditor.network.column.field': '字段',
  'albumTagEditor.network.selectAll': '全选',
  'albumTagEditor.network.selectFields': '选择要应用到专辑的字段',
  'albumTagEditor.network.title': '网络候选',
  'albumTagEditor.saveDescription': '保存会写入这张专辑内所有歌曲的嵌入标签，并立即同步媒体库。',
  'albumTagEditor.section.albumInfo': '专辑信息',
  'albumTagEditor.section.albumInfoDescription': '会批量写入这张专辑内的歌曲',
  'albumTagEditor.subtitle.albumBatch': '专辑级批量标签',
  'albumTagEditor.subtitle.unsaved': '未保存更改',
  'albumTagEditor.title': '编辑标签',
  'albumTagEditor.value.albumCandidate': '专辑候选',
  'albumTagEditor.value.empty': '空',
  'albumTagEditor.value.existingCover': '已有封面',
  'albumTagEditor.value.networkCover': '网络封面',
  'albumTagEditor.value.unknownAlbum': '未知专辑',
  'albumTagEditor.value.unknownArtist': '未知艺术家',
  'albumMenu.action.addToPlaylist': '加入歌单...',
  'albumMenu.action.addToQueue': '加入队列',
  'albumMenu.action.copyCover': '复制专辑封面',
  'albumMenu.action.copyInfo': '复制专辑信息',
  'albumMenu.action.deleteAlbum': '删除专辑',
  'albumMenu.action.editTags': '编辑标签',
  'albumMenu.action.likeAlbum': '喜欢专辑',
  'albumMenu.action.playAlbum': '播放专辑',
  'albumMenu.action.saveCover': '保存专辑封面',
  'albumMenu.action.unlikeAlbum': '取消喜欢专辑',
  'albumMenu.playlistSubmenu.aria': '选择歌单',
  'albumMenu.playlistSubmenu.empty': '没有本地歌单',
  'albumMenu.playlistSubmenu.itemCount': '{count} 首',
  'albumMenu.playlistSubmenu.loading': '读取歌单...',
  'app.navigation.main': '主导航',
  'app.navigation.utility': '工具导航',
  'app.toolbar.quickActions': '快捷操作',
  'app.toolbar.windowControls': '窗口控制',
  'app.window.minimize': '最小化',
  'app.window.maximize': '最大化',
  'app.window.restore': '还原',
  'app.window.fullscreen': '全屏',
  'app.window.exitFullscreen': '退出全屏',
  'app.window.close': '关闭',
  'firstRun.action.finish': '完成设置',
  'firstRun.action.next': '下一步',
  'firstRun.action.previous': '上一步',
  'firstRun.action.skip': '跳过',
  'firstRun.action.skipWizard': '跳过向导',
  'firstRun.aria.steps': '首次启动步骤',
  'firstRun.aria.summary': '当前向导选择摘要',
  'firstRun.audio.asio.description': '需要 ASIO 设备和可靠驱动。',
  'firstRun.audio.asio.hint': '专业',
  'firstRun.audio.asio.label': 'ASIO',
  'firstRun.audio.exclusive.description': '独占设备，适合确认稳定的外置声卡或 HiFi 调试。',
  'firstRun.audio.exclusive.hint': '高级',
  'firstRun.audio.exclusive.label': 'WASAPI Exclusive',
  'firstRun.audio.linuxShared.description': '通过 Linux 音频栈使用 ECHO 原生输出。',
  'firstRun.audio.linuxShared.hint': '高级',
  'firstRun.audio.linuxShared.label': 'Linux Shared',
  'firstRun.audio.shared.description': '高级音频引擎的日常共享输出。',
  'firstRun.audio.shared.hint': '高级',
  'firstRun.audio.shared.label': 'WASAPI Shared',
  'firstRun.audio.system.description': '最稳定，适合普通耳机、蓝牙、电脑扬声器。',
  'firstRun.audio.system.hint': '推荐',
  'firstRun.audio.system.label': '标准输出（推荐）',
  'firstRun.accounts.cookie.description': '如果平台登录窗口不可用，再手动粘贴 Cookie 并点“手动保存”，保存后用“检查”确认状态。',
  'firstRun.accounts.cookie.title': '备用方式',
  'firstRun.accounts.login.description': '网易云、QQ 音乐、Bilibili、SoundCloud 等账号优先点“登录并同步”，登录完成后 ECHO 会保存必要凭据。',
  'firstRun.accounts.login.title': '优先使用网页登录',
  'firstRun.accounts.note': '流媒体账号是可选能力，不影响本地曲库播放；不同平台权限不同，ECHO 只会使用平台实际返回的可播放内容。',
  'firstRun.accounts.open.description': '完成向导后进入“设置 > 集成 > 账号登录”，这里集中管理流媒体、MV、下载和歌词相关账号。',
  'firstRun.accounts.open.title': '入口位置',
  'firstRun.accounts.spotify.description': 'Spotify 走官方播放器/Connect，需要 Premium；它不会提供可下载音频 URL。',
  'firstRun.accounts.spotify.title': 'Spotify 注意',
  'firstRun.cache.chooseLocation': '选择缓存位置',
  'firstRun.cache.useDefault': '使用默认',
  'firstRun.currentSelection': '当前选择',
  'firstRun.defaultLocation': '默认位置',
  'firstRun.description': '按顺序确认曲库、缓存、扫描、输出、外观和账号入口。不确定的地方保留推荐值就好。',
  'firstRun.error.desktopBridgeCache': '桌面桥接不可用，暂时不能选择缓存位置。',
  'firstRun.error.desktopBridgeMusicFolder': '桌面桥接不可用，暂时不能选择音乐文件夹。',
  'firstRun.error.desktopBridgeSave': '桌面桥接不可用，暂时不能保存首次启动设置。',
  'firstRun.library.chooseFolder': '选择文件夹',
  'firstRun.library.noneSelected': '未选择，稍后添加也可以。',
  'firstRun.library.scanAfterFinish': '完成后扫描',
  'firstRun.message.saved': '首次启动设置已保存。',
  'firstRun.scan.balanced.description': '推荐。扫描速度和后台占用都比较稳。',
  'firstRun.scan.balanced.hint': '默认',
  'firstRun.scan.balanced.label': '均衡',
  'firstRun.scan.low.description': '更少打扰播放，扫描会慢一些。',
  'firstRun.scan.low.hint': '边听边扫',
  'firstRun.scan.low.label': '低占用',
  'firstRun.scan.performance.description': '优先尽快建库，适合电脑空闲时使用。',
  'firstRun.scan.performance.hint': '空闲时',
  'firstRun.scan.performance.label': '快速',
  'firstRun.step.audio.description': '普通耳机、蓝牙和电脑扬声器建议使用标准输出，稳定优先；外置声卡、独占模式或 ASIO 只建议在确认设备可靠后再启用。',
  'firstRun.step.audio.eyebrow': '4 / 7',
  'firstRun.step.audio.label': '输出',
  'firstRun.step.audio.title': '选择音频输出',
  'firstRun.step.appearance.description': '这里先决定整体明暗模式和主题配色。浅色适合白天和办公环境，深色适合夜间；不确定就跟随系统。',
  'firstRun.step.appearance.eyebrow': '5 / 7',
  'firstRun.step.appearance.label': '外观',
  'firstRun.step.appearance.title': '选择主题和明暗模式',
  'firstRun.step.accounts.description': '流媒体账号可以稍后登录。它主要影响在线搜索、歌单同步、MV/歌词匹配和部分下载能力，不会替代本地曲库。',
  'firstRun.step.accounts.eyebrow': '6 / 7',
  'firstRun.step.accounts.label': '账号',
  'firstRun.step.accounts.title': '流媒体账号怎么登录',
  'firstRun.step.cache.description': '封面、歌词、MV 缓存会占用磁盘空间。C 盘紧张时建议换到其他盘；之后也可以在设置里调整。',
  'firstRun.step.cache.eyebrow': '2 / 7',
  'firstRun.step.cache.label': '缓存',
  'firstRun.step.cache.title': '选择缓存位置',
  'firstRun.step.library.description': '选择音乐根目录后，ECHO 会读取标签、封面、时长和歌词线索来建立曲库。文件不会被移动或删除，也可以先跳过。',
  'firstRun.step.library.eyebrow': '1 / 7',
  'firstRun.step.library.label': '音乐',
  'firstRun.step.library.title': '选择音乐文件夹',
  'firstRun.step.scan.description': '首次扫描会比较忙。日常推荐均衡；如果正在听歌或电脑负载高，用低占用；电脑空闲时再用快速。',
  'firstRun.step.scan.eyebrow': '3 / 7',
  'firstRun.step.scan.label': '扫描',
  'firstRun.step.scan.title': '选择扫描方式',
  'firstRun.step.summary.description': '确认后只保存这些基础设置。之后可以在设置里重新打开首次启动指引，账号也可以随时补登录。',
  'firstRun.step.summary.eyebrow': '7 / 7',
  'firstRun.step.summary.label': '确认',
  'firstRun.step.summary.title': '确认设置',
  'firstRun.summary.addLater': '稍后添加',
  'firstRun.summary.accounts': '账号',
  'firstRun.summary.accountsLater': '稍后在设置 > 集成登录',
  'firstRun.summary.cache': '缓存',
  'firstRun.summary.kicker': '摘要',
  'firstRun.summary.music': '音乐',
  'firstRun.summary.noFileMove': '不会移动或删除你的音乐文件。',
  'firstRun.summary.output': '输出',
  'firstRun.summary.readyDescription': '点击完成后保存设置。若已选择文件夹并勾选扫描，ECHO 会开始建立曲库索引。',
  'firstRun.summary.readyTitle': '可以开始了',
  'firstRun.summary.scan': '扫描',
  'firstRun.summary.scanWithFolder': '{mode}，完成后扫描',
  'firstRun.summary.theme': '外观',
  'firstRun.summary.themeValue': '{mode}，{preset}',
  'firstRun.theme.dark.description': '降低夜间亮度，适合暗光环境和 OLED 屏。',
  'firstRun.theme.dark.hint': '夜间',
  'firstRun.theme.light.description': '文字更清楚，适合白天、办公和截图。',
  'firstRun.theme.light.hint': '清爽',
  'firstRun.theme.modeTitle': '明暗模式',
  'firstRun.theme.presetTitle': '主题配色',
  'firstRun.theme.system.description': '跟随 Windows 或系统外观自动切换。',
  'firstRun.theme.system.hint': '省心',
  'firstRun.title': '欢迎使用 ECHO Next',
  'downloads.action.addToQueue': '加入队列',
  'downloads.action.cancelJob': '取消任务',
  'downloads.action.changeFolder': '更换文件夹',
  'downloads.action.checkTools': '检测环境',
  'downloads.action.chooseFolder': '选择文件夹',
  'downloads.action.clearCompleted': '清除已完成',
  'downloads.action.creating': '创建中',
  'downloads.action.search': '搜索',
  'downloads.action.searching': '搜索中',
  'downloads.description': '使用内置 yt-dlp 搜索 YouTube / Bilibili，并只下载最高可用音频。',
  'downloads.empty.noResults.description': '换个关键词再试试。',
  'downloads.empty.noResults.title': '暂无搜索结果',
  'downloads.empty.queue.description': '粘贴链接或搜索结果下载后，会在这里看到真实进度。',
  'downloads.empty.queue.title': '队列为空',
  'downloads.empty.searching.description': '正在查询 {scope}。',
  'downloads.empty.searching.title': '正在搜索',
  'downloads.error.cookieFallback': '无法读取浏览器 Cookie，已自动尝试不使用登录状态搜索。',
  'downloads.error.ipcUnavailable': '当前运行环境未暴露下载 IPC。',
  'downloads.error.operationFailed': '下载操作失败',
  'downloads.folder.required': '请选择下载文件夹',
  'downloads.job.imported': '已导入曲库',
  'downloads.job.savedTo': '保存到 {path}',
  'downloads.job.waitingProgress': '等待进度',
  'downloads.message.clearedTerminal': '已清除完成、失败和取消的任务。',
  'downloads.message.completed': '下载完成：{title}',
  'downloads.message.queued': '已加入下载队列。',
  'downloads.message.resultQueued': '已加入队列：{title}',
  'downloads.queue.title': '下载队列',
  'downloads.search.aria': '搜索下载',
  'downloads.search.downloadAudio': '下载音频',
  'downloads.search.joined': '已加入队列',
  'downloads.search.placeholder': '搜索歌曲、艺人或视频标题',
  'downloads.search.providerErrorItem': '{provider}：{error}',
  'downloads.search.providerErrors': '部分平台搜索失败：{errors}',
  'downloads.search.scopeAria': '搜索平台',
  'downloads.search.title': '搜索下载',
  'downloads.search.unknownUploader': '未知作者',
  'downloads.search.views': '{count} 次播放',
  'downloads.search.viewsWan': '{count} 万次播放',
  'downloads.settings.audioStrategy': '音频策略',
  'downloads.settings.bestAvailable': '最高可用音质',
  'downloads.settings.bindMvAfterImport': '导入后绑定源 URL 为 MV',
  'downloads.settings.importToLibrary': '完成后导入曲库',
  'downloads.settings.outputDirectory': '下载文件夹',
  'downloads.settings.title': '下载设置',
  'downloads.status.bindingMv': '绑定 MV',
  'downloads.status.cancelled': '已取消',
  'downloads.status.completed': '已完成',
  'downloads.status.downloading': '下载中',
  'downloads.status.extractingAudio': '提取音频',
  'downloads.status.failed': '失败',
  'downloads.status.importing': '导入曲库',
  'downloads.status.probing': '解析链接',
  'downloads.status.queued': '排队中',
  'downloads.title': '下载',
  'downloads.tools.notBundled': '未随应用安装',
  'downloads.tools.notDetected': '未检测到',
  'downloads.tools.title': '环境检测',
  'downloads.url.placeholder': '粘贴 YouTube / Bilibili / SoundCloud / osu! 链接',
  'downloads.url.title': '粘贴链接下载',
  'accountProvider.bilibili': 'Bilibili',
  'accountProvider.kugou': '酷狗音乐',
  'accountProvider.netease': '网易云音乐',
  'accountProvider.osu': 'osu!',
  'accountProvider.qqmusic': 'QQ 音乐',
  'accountProvider.soundcloud': 'SoundCloud',
  'accountProvider.spotify': 'Spotify',
  'accountProvider.tidal': 'TIDAL',
  'accountProvider.unknown': '未知账号',
  'accountProvider.youtube': 'YouTube',
  'desktopLyrics.aria.stage': '桌面歌词',
  'desktopLyrics.control.close': '关闭',
  'desktopLyrics.control.colorSwatch': '颜色 {color}',
  'desktopLyrics.control.customColor': '自定义颜色',
  'desktopLyrics.control.decreaseFontSize': '减小字号',
  'desktopLyrics.control.decreaseScale': '缩小',
  'desktopLyrics.control.increaseFontSize': '增大字号',
  'desktopLyrics.control.increaseScale': '放大',
  'desktopLyrics.control.lock': '锁定',
  'desktopLyrics.control.resetPosition': '重置位置',
  'desktopLyrics.control.romanization': '桌面歌词显示罗马音',
  'desktopLyrics.control.themeColor': '跟随主题颜色',
  'desktopLyrics.control.translation': '桌面歌词显示翻译',
  'desktopLyrics.control.translationShort': '译',
  'desktopLyrics.primary.empty': '暂无歌词',
  'desktopLyrics.primary.instrumental': '纯音乐，请欣赏',
  'desktopLyrics.secondary.waiting': '等待播放',
  'lyricsView.empty.instrumental': '纯音乐，请欣赏',
  'lyricsView.empty.noLyrics': '暂无歌词',
  'mvPanel.action.close': '关闭',
  'mvPanel.action.copied': '已复制',
  'mvPanel.action.copy': '复制',
  'mvPanel.action.dismissUnavailable': '关闭 MV 不可用提示',
  'mvPanel.diagnostics.title': 'MV 诊断报告',
  'mvPanel.notice.unavailable': 'MV 不可用',
  'mvPanel.status.bilibiliBlocked': 'Bilibili 暂时拒绝解析，请稍后重试或外部打开',
  'mvPanel.status.databaseUnread': 'MV 数据库不可读',
  'mvPanel.status.externalRequired': '当前 MV 需要外部播放',
  'mvPanel.status.inAppUnavailable': '当前 MV 无法在应用内播放',
  'mvPanel.status.loadFailed': 'MV 加载失败',
  'mvPanel.status.loading': '正在加载 MV',
  'mvPanel.status.localUnsupported': '本地视频格式不支持',
  'mvPanel.status.missingUrl': '缺少可播放地址',
  'mvPanel.status.networkFailed': '网络 MV 请求失败',
  'mvPanel.status.notFound': '未找到可播放 MV',
  'mvPanel.status.temporaryPlayback': '临时 MV 播放中，数据库待修复',
  'mvPanel.status.unavailable': 'MV 不可用',
  'mvPanel.status.videoFailed': '视频加载失败',
  'miniPlayer.action.close': '关闭迷你播放器',
  'miniPlayer.action.closeQueue': '收起播放队列',
  'miniPlayer.action.closeShort': '关闭',
  'miniPlayer.action.next': '下一首',
  'miniPlayer.action.openQueue': '打开播放队列',
  'miniPlayer.action.pause': '暂停',
  'miniPlayer.action.play': '播放',
  'miniPlayer.action.previous': '上一首',
  'miniPlayer.action.resetPosition': '重置位置',
  'miniPlayer.action.volume': '调节音量',
  'miniPlayer.aria.progress': '播放进度',
  'miniPlayer.aria.queue': '播放队列',
  'miniPlayer.aria.shell': '迷你播放器',
  'miniPlayer.aria.volume': '音量',
  'miniPlayer.artist.unknown': '未知艺术家',
  'miniPlayer.status.hqPlayerTakeover': 'HQPlayer 接管中',
  'miniPlayer.status.queueEmpty': '队列为空',
  'miniPlayer.status.ready': '就绪',
  'playerStatus.audioSpecifications': '音频规格',
  'playerStatus.ready': '就绪',
  'playerStatus.streaming': '流媒体',
  'playerSpeed.label': '播放速度',
  'playerSpeed.reset': '重置播放速度',
  'playerVolume.fixed.disable': '关闭固定音量',
  'playerVolume.fixed.enable': '开启固定音量',
  'playerVolume.fixed.enabled': '固定音量已开启',
  'playerVolume.fixed.dsdAutoLocked': 'DSD 播放中已自动锁定音量',
  'playerVolume.fixed.title': '固定音量',
  'import.dragDrop.desktopBridgeUnavailable': '桌面桥接不可用。请在 ECHO Next 桌面端导入拖拽文件。',
  'import.dragDrop.files.empty': '未找到可导入的音频文件。',
  'import.dragDrop.files.failed': '{count} 个文件导入失败',
  'import.dragDrop.files.ignored': '忽略 {count} 个不支持文件',
  'import.dragDrop.files.imported': '已导入 {count} 首歌曲',
  'import.dragDrop.files.summaryWithOutput': '{summary}。文件已保存到：{outputDirectory}',
  'import.dragDrop.noDroppedFiles': '未读取到拖拽文件。',
  'import.dragDrop.overlay.description': '文件会保存到下载文件夹并加入曲库',
  'import.dragDrop.overlay.title': '拖入音乐或 osu! 谱面以导入曲库',
  'import.dragDrop.paths.addedFolders': '已添加 {count} 个文件夹',
  'import.dragDrop.paths.empty': '未找到可导入的音乐文件或文件夹',
  'import.dragDrop.paths.failed': '{count} 个路径导入失败',
  'import.dragDrop.paths.ignored': '忽略 {count} 个不支持文件',
  'import.dragDrop.paths.importedFiles': '已导入 {count} 个文件',
  'import.dragDrop.paths.missing': '跳过 {count} 个不可访问路径',
  'import.dragDrop.paths.scannedAudioFolders': '已扫描 {count} 个音乐文件所在文件夹',
  'albumDetail.action.addToQueue': '加入队列',
  'albumDetail.action.back': '专辑',
  'albumDetail.action.likeAlbum': '喜欢专辑',
  'albumDetail.action.more': '更多专辑操作',
  'albumDetail.action.openSource': '打开来源',
  'albumDetail.action.playNow': '立即播放',
  'albumDetail.action.readingAlbum': '正在读取专辑',
  'albumDetail.action.refresh': '刷新',
  'albumDetail.action.showInFolder': '在文件夹中显示',
  'albumDetail.action.unlikeAlbum': '取消喜欢专辑',
  'albumDetail.aria.details': '{album} 专辑详情',
  'albumDetail.aria.info': '专辑信息',
  'albumDetail.aria.metadata': '专辑元数据',
  'albumDetail.aria.openArtist': '打开艺术家 {artist}',
  'albumDetail.aria.sections': '专辑分区',
  'albumDetail.aria.trackConsole': '{album} 曲目控制台',
  'albumDetail.artist.notFound': '没有找到艺术家：{artist}',
  'albumDetail.count.albums': '{count} 张专辑',
  'albumDetail.count.loadedAlbums': '{loaded}/{total} 张专辑',
  'albumDetail.count.loadedTracks': '{loaded}/{total} 首歌',
  'albumDetail.count.tracks': '{count} 首歌',
  'albumDetail.credit.role.arrangement': '编曲',
  'albumDetail.credit.role.composer': '作曲',
  'albumDetail.credit.role.engineering': '录音与工程',
  'albumDetail.credit.role.label': '发行与厂牌',
  'albumDetail.credit.role.lyrics': '作词',
  'albumDetail.credit.role.other': '其他贡献',
  'albumDetail.credit.role.performer': '演奏',
  'albumDetail.credit.role.production': '制作',
  'albumDetail.credit.role.vocal': '演唱与声部',
  'albumDetail.credit.source.album': '专辑贡献',
  'albumDetail.credit.source.label': '厂牌',
  'albumDetail.credit.source.recording': '曲目贡献',
  'albumDetail.credit.source.work': '作品贡献',
  'albumDetail.credit.summary.arrangement': '编曲、配器和改编相关贡献。',
  'albumDetail.credit.summary.composer': '来自发行、录音或作品关系的音乐创作信息。',
  'albumDetail.credit.summary.engineering': '录音、混音、母带和声音工程信息。',
  'albumDetail.credit.summary.label': '与发行相关的厂牌和目录信息。',
  'albumDetail.credit.summary.lyrics': '歌词、文字、脚本和相关写作贡献。',
  'albumDetail.credit.summary.other': '在线元数据匹配到的其他贡献。',
  'albumDetail.credit.summary.performer': '发行或单曲录音中的演奏与表演贡献。',
  'albumDetail.credit.summary.production': '制作人和制作侧贡献。',
  'albumDetail.credit.summary.vocal': '主唱、客座声音和演唱相关贡献。',
  'albumDetail.credits.count': '{count} 位贡献者 / 组织',
  'albumDetail.credits.entries': '{count} 条',
  'albumDetail.credits.heading': '专辑贡献',
  'albumDetail.credits.overviewAria': '贡献概览',
  'albumDetail.credits.trackPrefix': '曲目：{title}',
  'albumDetail.duration.hours': '{hours} 小时 {minutes} 分钟',
  'albumDetail.duration.minutes': '{minutes} 分钟',
  'albumDetail.fact.format': '格式',
  'albumDetail.fact.genre': '流派',
  'albumDetail.fact.library': '曲库',
  'albumDetail.fact.released': '发行',
  'albumDetail.information.albumProfile': '专辑资料',
  'albumDetail.information.artistProfile': '艺术家资料',
  'albumDetail.information.atGlance': '概览',
  'albumDetail.information.externalLinks': '外部链接',
  'albumDetail.information.overviewAria': '专辑与艺术家概览',
  'albumDetail.label.album': '专辑',
  'albumDetail.online.emptyDescription': 'MusicBrainz 和 Wikipedia 没有返回足够可靠的专辑匹配数据。',
  'albumDetail.online.emptyTitle': '没有找到可靠的在线信息',
  'albumDetail.online.match': 'MusicBrainz 匹配',
  'albumDetail.online.noSource': '没有匹配来源',
  'albumDetail.online.possibleMatch': '可能的 MusicBrainz 匹配',
  'albumDetail.online.reading': '正在读取在线专辑信息...',
  'albumDetail.online.sources': '在线来源',
  'albumDetail.online.unavailable': '在线信息不可用',
  'albumDetail.ratings.count': '{count} 个评分',
  'albumDetail.ratings.overviewAria': '外部专辑评分',
  'albumDetail.releases.count': '{count} 个发行版本',
  'albumDetail.releases.current': '当前匹配',
  'albumDetail.releases.currentHint': '标记当前本地专辑匹配到的 MusicBrainz 版本',
  'albumDetail.releases.heading': '版本 / 发行',
  'albumDetail.releases.overviewAria': '专辑发行版本概览',
  'albumDetail.related.aria': '{artist} 在曲库中的专辑',
  'albumDetail.related.heading': '我的曲库',
  'albumDetail.related.loading': '正在加载专辑',
  'albumDetail.related.thisAlbum': '当前专辑',
  'albumDetail.sources.barcode': '条码',
  'albumDetail.sources.catalogNumber': '目录号',
  'albumDetail.sources.copyright': '版权信息',
  'albumDetail.sources.kind.database': '数据库',
  'albumDetail.sources.kind.official': '官方',
  'albumDetail.sources.kind.other': '网页',
  'albumDetail.sources.kind.reference': '资料',
  'albumDetail.sources.kind.streaming': '流媒体',
  'albumDetail.sources.labels': '厂牌 / 目录',
  'albumDetail.sources.linksAria': '专辑外部来源链接',
  'albumDetail.sources.releaseAria': '当前匹配发行信息',
  'albumDetail.sources.releaseDetails': '当前发行',
  'albumDetail.status.addedToQueue': '已加入队列 {count} 首。',
  'albumDetail.status.copiedCover': '已复制封面原图',
  'albumDetail.status.libraryReady': '{value} 就绪',
  'albumDetail.status.readingSignal': '正在读取信号',
  'albumDetail.status.unknownGenre': '未知流派',
  'albumDetail.status.unknownLength': '未知时长',
  'albumDetail.status.unknownYear': '未知年份',
  'albumDetail.tab.credits': '贡献',
  'albumDetail.tab.information': '信息',
  'albumDetail.tab.releases': '版本',
  'albumDetail.tab.sources': '来源',
  'albumDetail.tab.tracks': '曲目',
  'albumDetail.texture.discs': '{count} 张碟',
  'albumDetail.tracks.action.like': '喜欢 {title}',
  'albumDetail.tracks.action.likeTitle': '喜欢',
  'albumDetail.tracks.action.unlike': '取消喜欢 {title}',
  'albumDetail.tracks.action.unlikeTitle': '取消喜欢',
  'albumDetail.tracks.aria': '专辑曲目',
  'albumDetail.tracks.column.signal': '信号',
  'albumDetail.tracks.column.time': '时长',
  'albumDetail.tracks.column.title': '标题',
  'albumDetail.tracks.confirm.delete': '删除音乐文件？\n{title}',
  'albumDetail.tracks.empty': '这张专辑没有曲目。',
  'albumDetail.tracks.error.actionUnavailable': '这个曲目操作暂不可用。',
  'albumDetail.tracks.error.desktopBridgeActions': '桌面桥接不可用。请在 ECHO Next 桌面版中使用文件操作。',
  'albumDetail.tracks.error.desktopBridgeEdit': '桌面桥接不可用。请在 ECHO Next 桌面版中编辑内嵌标签。',
  'albumDetail.tracks.error.desktopBridgeRead': '桌面桥接不可用。请在 ECHO Next 桌面版中读取专辑曲目。',
  'albumDetail.tracks.error.noCoverSaved': '没有保存任何封面。',
  'albumDetail.tracks.error.noCoverToCopy': '这首歌没有可复制的封面。',
  'albumDetail.tracks.error.remoteFileAction': '远程曲目暂不支持本地文件操作。',
  'albumDetail.tracks.formatAria': '曲目格式',
  'albumDetail.tracks.loadMore': '加载更多',
  'albumDetail.tracks.loading': '加载中...',
  'albumDetail.tracks.status.addedToPlaylist': '已加入歌单：{playlist}',
  'albumDetail.tracks.status.albumNotFound': '已经在查看这张专辑：{title}',
  'albumDetail.tracks.status.notInQueue': '队列中没有这首歌：{title}',
  'albumDetail.tracks.status.reloadedTags': '已从内嵌标签重新加载：{title}',
  'albumDetail.tracks.status.removedFromQueue': '已从队列移除：{title}',
  'albumDetail.tracks.summaryAria': '曲目摘要',
  'audioDrawer.action.close': '关闭音频设置',
  'audioDrawer.action.copiedDiagnostics': '已复制播放诊断信息',
  'audioDrawer.action.copyDiagnostics': '复制播放诊断信息',
  'audioDrawer.action.hideDevice': '隐藏设备',
  'audioDrawer.action.openAsioPanel': '打开 ASIO 面板',
  'audioDrawer.action.resetEngine': '重置音频引擎',
  'audioDrawer.action.resetEngineBusy': '正在重置音频引擎',
  'audioDrawer.action.resetEngineDone': '音频引擎已重置',
  'audioDrawer.action.restore': '恢复',
  'audioDrawer.asioLatency.description': '根据当前打开的缓冲估算输出端会多等多久再播放。数值越低越跟手，数值越高越稳、越不容易爆音。',
  'audioDrawer.asioLatency.recommended': '推荐延迟',
  'audioDrawer.asioLatency.status': '请求 {requested} frames / 已打开 {opened} frames',
  'audioDrawer.asioLatency.value': '{value} ms',
  'audioDrawer.asioRoutes.title': 'ASIO 输出通道',
  'audioDrawer.badge.bitPerfectReady': 'Bit-perfect ready',
  'audioDrawer.badge.dspActive': 'DSP active',
  'audioDrawer.badge.juceFallback': 'JUCE 已降级',
  'audioDrawer.badge.juceOutput': 'JUCE 输出',
  'audioDrawer.badge.resampling': 'Resampling',
  'audioDrawer.badge.soxrResampler': 'SOXR',
  'audioDrawer.badge.speedUp': 'Speed Up',
  'audioDrawer.buffer.asio': 'ASIO 缓冲',
  'audioDrawer.buffer.auto': '自动',
  'audioDrawer.buffer.collapsedDescription': '默认收起；点开可调整延迟档位和 ASIO 缓冲。',
  'audioDrawer.buffer.default': '默认',
  'audioDrawer.buffer.latencyProfile': '延迟档位',
  'audioDrawer.buffer.low': '低',
  'audioDrawer.buffer.profileDefault': '跟随档位默认',
  'audioDrawer.buffer.safer': '更稳',
  'audioDrawer.buffer.stable': '稳定',
  'audioDrawer.buffer.title': '缓冲设置',
  'audioDrawer.buffer.ultraLow': '超低延迟',
  'audioDrawer.device.asioDriver': 'ASIO 驱动',
  'audioDrawer.device.lowLatency': '低延迟',
  'audioDrawer.device.selected': '已选择',
  'audioDrawer.device.systemAudio': 'Windows直出',
  'audioDrawer.device.systemAudioDescription': '默认 Windows 音频路径，适合普通耳机、蓝牙、电脑扬声器',
  'audioDrawer.device.systemDefault': '系统默认',
  'audioDrawer.device.systemDefaultOutput': '系统默认输出',
  'audioDrawer.device.systemOutput': '系统输出',
  'audioDrawer.device.systemSelectedRoute': '系统选择的路径',
  'audioDrawer.empty.asioDevices': '没有找到 ASIO 输出设备。',
  'audioDrawer.empty.hiddenDevices': '没有隐藏设备。',
  'audioDrawer.empty.systemDevices': '没有找到系统输出设备。',
  'audioDrawer.error.desktopBridgeUnavailable': '桌面桥接不可用',
  'audioDrawer.meter.direct': '直通',
  'audioDrawer.meter.chain': '链路',
  'audioDrawer.meter.mode': '模式',
  'audioDrawer.meter.output': '输出',
  'audioDrawer.meter.rate': '采样率',
  'audioDrawer.meter.resample': '重采样',
  'audioDrawer.meter.source': '音源',
  'audioDrawer.meter.latency': '延迟',
  'audioDrawer.guard.asioUnavailable.description': '默认关闭。遇到 No device found 后会短暂跳过同一个 ASIO 设备，并改用安全的共享输出。',
  'audioDrawer.guard.asioUnavailable.title': 'ASIO 不可用保护',
  'audioDrawer.guard.exclusiveInstability.description': '默认关闭。WASAPI 独占持续 underrun 或设备变得不稳定时，开启后会从当前位置切到安全共享输出。',
  'audioDrawer.guard.exclusiveInstability.title': '独占不稳定自动切共享',
  'audioDrawer.guard.soxrFallback.description': '默认开启。如果共享 SOXR 重采样在 PCM 开始前不可用，会回退到 FFmpeg 默认重采样。',
  'audioDrawer.guard.soxrFallback.title': 'SOXR 回退保护',
  'audioDrawer.latency.balanced': '均衡',
  'audioDrawer.latency.balancedDetail': '2048 frames',
  'audioDrawer.latency.lowLatency': '低延迟',
  'audioDrawer.latency.lowLatencyDetail': '1024 frames / 不稳升均衡',
  'audioDrawer.latency.stable': '稳定',
  'audioDrawer.latency.stableDetail': '8192 frames',
  'audioDrawer.mode.exclusive': '独占',
  'audioDrawer.mode.exclusiveCandidate': '独占候选',
  'audioDrawer.mode.directSound': 'DirectSound 兼容',
  'audioDrawer.mode.shared': '共享',
  'audioDrawer.note.asio': '低延迟专业音频接口，需要驱动支持。',
  'audioDrawer.note.currentOutput': '这里显示现在真正使用的输出路径；共享适合日常，ASIO 和 WASAPI 独占会以金色标出。',
  'audioDrawer.note.engine': '这里快速查看输出设备、模式、采样率、EQ 和重采样状态。',
  'audioDrawer.note.juceOutput': '默认关闭。FFmpeg 兼容路径作为默认输出；需要时可手动开启 JUCE 输出，失败会自动回退。',
  'audioDrawer.note.juceDecode': '默认关闭。播放 DSD 需打开。开启后，本地 WAV/FLAC/MP3 在无需重采样时使用长驻原生解码；MP3 走 Windows Media，失败会自动回退 FFmpeg。',
  'audioDrawer.note.dsdDop': '默认关闭。本地 DSF 在独占或 ASIO 下尝试 DoP 直出；失败会自动回退 FFmpeg PCM，最终以 DAC 显示为准。',
  'audioDrawer.note.asioNativeDsd': '默认关闭。仅 ASIO + 本地 DSF + DoP 开启且无 EQ/音量/变速/DSP 时尝试；失败会退回现有 DoP/PCM。',
  'audioDrawer.note.dsdAutoVolumeLock': '默认关闭。开启后播放 DSD 时临时锁定 ECHO 音量为 100%，切回 PCM 后恢复到原来的音量。',
  'audioDrawer.note.releaseExclusiveOnPause': '实验功能。暂停时释放 WASAPI 独占，让其它软件临时出声；恢复播放会重新抢独占，失败时临时降到共享。',
  'audioDrawer.option.juceOutput': 'JUCE 主输出',
  'audioDrawer.option.juceDecode': '长驻原生解码',
  'audioDrawer.option.dsdDop': 'DSD DoP 直出试验',
  'audioDrawer.option.asioNativeDsd': 'ASIO 原生 DSD 实验',
  'audioDrawer.option.dsdAutoVolumeLock': '播放 DSD 时自动锁定音量',
  'audioDrawer.option.releaseExclusiveOnPause': '暂停释放独占实验',
  'audioDrawer.option.active': '开启',
  'audioDrawer.option.set': '设置',
  'audioDrawer.option.automix': '启用 Automix',
  'audioDrawer.option.automixActive': '当前播放已进入 Automix 预混路径。',
  'audioDrawer.option.automixDescription': '默认关闭。开启后会在队列连续播放时自动把当前歌曲尾段与下一首重叠淡入淡出。',
  'audioDrawer.option.rememberOutput': '保存输出设置',
  'audioDrawer.option.rememberOutputDescription': '下次启动时恢复所选输出设备、输出模式和缓冲等参数。',
  'audioDrawer.option.fixedVolume': '固定音量',
  'audioDrawer.option.fixedVolumeDescription': '开启后会将 ECHO 音量控制锁定为 100%；ReplayGain 仍会独立生效。',
  'audioDrawer.option.lowLoadPlaybackMode': '低负载播放模式',
  'audioDrawer.option.lowLoadPlaybackModeDescription': '打开后播放期间禁用实时频谱、频繁播放页刷新、ReplayGain/BPM 重分析、逐字歌词高频刷新、自动歌词深搜、封面/艺人图抓取和 MV 预加载。',
  'audioDrawer.option.lowLoadPlaybackEnhancements': '低负载增强保护',
  'audioDrawer.option.lowLoadPlaybackEnhancementsDescription': '默认关闭。仅在低负载播放模式开启时生效，会进一步降低轮询、桌面歌词、诊断、后台库任务、流媒体预热和 MV 自动搜索负载。',
  'audioDrawer.option.showAsioPanelSettings': '是否显示 ASIO 面板设置',
  'audioDrawer.option.showAsioPanelSettingsDescription': '默认关闭。开启后才在 ASIO 设备下显示“打开 ASIO 面板”按钮。',
  'audioDrawer.option.alsaShared': 'ALSA',
  'audioDrawer.option.alsaSharedDescription': '通过 Linux ALSA 设备输出。',
  'audioDrawer.option.directSound': 'DirectSound 兼容',
  'audioDrawer.option.directSoundDescription': '手动兼容模式，延迟较大；只在 WASAPI 播放异常时尝试。',
  'audioDrawer.option.linuxAutoShared': '自动',
  'audioDrawer.option.linuxAutoSharedDescription': '优先使用 ALSA，并尊重系统的 PipeWire/ALSA 兼容层配置。',
  'audioDrawer.option.sharedBackend': '共享后端',
  'audioDrawer.option.wasapiShared': 'WASAPI Shared',
  'audioDrawer.option.wasapiSharedDescription': '日常 Windows 共享输出路径。',
  'audioDrawer.option.wasapiExclusive': 'WASAPI 独占模式',
  'audioDrawer.option.wasapiExclusiveDescription': '共享是日常 Windows 输出路径。独占会请求同一设备并绕过共享混音器，只建议在确认 DAC/声卡和驱动稳定时使用；Realtek 等板载驱动兼容性较差，可能导致无声、卡顿或切换失败。',
  'audioDrawer.section.advancedOutput': '高级音频引擎',
  'audioDrawer.section.advancedOutputDescription': '适合外置声卡、WASAPI Exclusive、ASIO 和 HiFi 调试',
  'audioDrawer.section.automix': 'Automix',
  'audioDrawer.section.asioDevices': 'ASIO 输出设备',
  'audioDrawer.section.currentOutput': '当前输出',
  'audioDrawer.section.hiddenDevices': '隐藏设备',
  'audioDrawer.section.systemDevices': '推荐输出',
  'audioDrawer.signal.balanceDsp': 'Balance DSP',
  'audioDrawer.signal.bitPerfect': 'Bit-perfect',
  'audioDrawer.signal.dspOn': 'DSP On',
  'audioDrawer.signal.eqOff': 'EQ Off',
  'audioDrawer.signal.eqOn': 'EQ On',
  'audioDrawer.signal.asioSdkOutput': 'ASIO SDK 输出',
  'audioDrawer.signal.ffmpegDecode': 'FFmpeg 解码',
  'audioDrawer.signal.dsdDop': 'DSF bitstream -> DoP',
  'audioDrawer.signal.dsdDopFallback': 'DSD DoP 已降级',
  'audioDrawer.signal.dsdDopStandby': 'DoP 未适用',
  'audioDrawer.signal.juceDecode': 'JUCE 解码',
  'audioDrawer.signal.juceDecodeFallback': 'JUCE 解码已降级',
  'audioDrawer.signal.juceDecodeStandby': 'JUCE 解码未适用',
  'audioDrawer.signal.nativeRate': '原生采样率',
  'audioDrawer.signal.noActiveSource': '没有活跃音源',
  'audioDrawer.signal.pending': '等待中',
  'audioDrawer.signal.processed': '已处理',
  'audioDrawer.signal.sharedMixer': '共享混音器',
  'audioDrawer.signal.standardPath': '标准路径',
  'audioDrawer.status.noTrack': '没有曲目',
  'audioDrawer.status.ratePending': '采样率待定',
  'audioDrawer.status.sampleRatePending': '采样率待定',
  'audioDrawer.title': '音频设置',
  'audioDrawer.warning.highOutputSampleRate': '当前音频设备采样率过高，可能导致播放速度异常，建议改为 48 kHz。',
  'audioProfessional.action.hideDetails': '收起专业详情',
  'audioProfessional.action.refresh': '刷新状态',
  'audioProfessional.action.showDetails': '展开专业详情',
  'audioProfessional.badge.bitPerfect': 'Bit-perfect',
  'audioProfessional.badge.dsp': 'DSP active',
  'audioProfessional.badge.protect': 'Protect',
  'audioProfessional.badge.replayGain': 'ReplayGain',
  'audioProfessional.badge.resampling': '重采样',
  'audioProfessional.badge.sampleMismatch': '采样率不匹配',
  'audioProfessional.badge.warning': '设备异常/警告',
  'audioProfessional.issue.reason': '异常原因',
  'audioProfessional.issue.audioLevelClipped': '实时电平检测到削波，请降低前级增益或关闭增益类 DSP。',
  'audioProfessional.issue.audioLevelClippingRisk': '实时电平接近 0 dBFS，有削波风险。',
  'audioProfessional.issue.dspClippingRisk': 'DSP 链路输出有削波风险，Protect limiter 已进入待命监控。',
  'audioProfessional.issue.dspLimiterProtecting': 'Protect limiter 正在保护输出，说明 DSP 后级信号已经超过安全阈值。',
  'audioProfessional.issue.roomCorrectionBitPerfectDisabled': '房间校正会关闭 bit-perfect 输出。',
  'audioProfessional.issue.roomCorrectionClippingRisk': '房间校正输出有削波风险，请降低 FIR Trim 或启用 Auto Gain。',
  'audioProfessional.issue.sharedMixRateTooHigh': 'Windows 共享采样率过高：设备是 {deviceRate}，ECHO 当前输出 {decoderRate} PCM，可能导致变速。建议把 Windows 默认格式改到 48 kHz。',
  'audioProfessional.issue.windowsDefaultFormatUnusual': 'Windows 默认格式设置偏高：当前是 {deviceRate}。ECHO 只会提醒，不会修改系统设置；建议改到 48 kHz。',
  'audioProfessional.group.directDsp': '直通与 DSP',
  'audioProfessional.group.playbackChain': '播放链路',
  'audioProfessional.group.sampleRate': '采样率链路',
  'audioProfessional.group.stability': '稳定性',
  'audioProfessional.signal.decode': '解码',
  'audioProfessional.signal.dsp': 'DSP',
  'audioProfessional.signal.fir': 'FIR',
  'audioProfessional.signal.headroom': '余量',
  'audioProfessional.signal.native': '原生',
  'audioProfessional.signal.output': '输出',
  'audioProfessional.signal.source': '来源',  'audioProfessional.row.actualBuffer': '实际 buffer',
  'audioProfessional.row.actualDeviceSampleRate': '实际设备采样率',
  'audioProfessional.row.bitDepth': '位深',
  'audioProfessional.row.bitPerfect': 'Bit-perfect',
  'audioProfessional.row.bitrate': '码率',
  'audioProfessional.row.buffered': '当前缓冲',
  'audioProfessional.row.channelBalance': '声道平衡',
  'audioProfessional.row.channels': '声道',
  'audioProfessional.row.clippingProtection': '削波保护',
  'audioProfessional.row.codec': '格式',
  'audioProfessional.row.decodeBackend': '解码后端',
  'audioProfessional.row.decoderOutputSampleRate': '解码输出',
  'audioProfessional.row.deviceBuffer': '设备 buffer',
  'audioProfessional.row.eq': 'EQ',
  'audioProfessional.row.error': '错误',
  'audioProfessional.row.fileSampleRate': '音源采样率',
  'audioProfessional.row.latencyProfile': '延迟档位',
  'audioProfessional.row.outputBackend': '输出后端',
  'audioProfessional.row.outputDevice': '输出设备',
  'audioProfessional.row.outputLatency': '输出延迟',
  'audioProfessional.row.outputMode': '输出模式',
  'audioProfessional.row.replayGain': 'ReplayGain',
  'audioProfessional.row.protectLimiter': 'Protect limiter',
  'audioProfessional.row.roomCorrection': '房间校正',
  'audioProfessional.row.requestedBuffer': '请求 buffer',
  'audioProfessional.row.requestedOutputSampleRate': '请求输出',
  'audioProfessional.row.resampler': '重采样器',
  'audioProfessional.row.resampling': '重采样',
  'audioProfessional.row.sampleRateMismatch': '采样率不匹配',
  'audioProfessional.row.signalPath': '信号路径',
  'audioProfessional.row.sharedDeviceSampleRate': '共享设备采样率',
  'audioProfessional.row.sharedStability': '共享稳定档',
  'audioProfessional.row.soxr': 'SOXR',
  'audioProfessional.row.state': '状态',
  'audioProfessional.row.underrun': 'Underrun',
  'audioProfessional.row.warnings': '警告',
  'audioProfessional.summary.pending': '等待音频状态',
  'audioProfessional.title': '专业播放状态',
  'audioProfessional.value.disabled': '关闭',
  'audioProfessional.value.dspPath': 'DSP 路径：{modules}',
  'audioProfessional.value.enabled': '开启',
  'audioProfessional.value.nativePath': '原生直通',
  'audioProfessional.value.no': '否',
  'audioProfessional.value.pending': '待确认',
  'audioProfessional.value.ready': '可直通',
  'audioProfessional.value.sharedMixer': '共享混音',
  'audioProfessional.value.systemDefault': '系统默认输出',
  'audioProfessional.value.unknown': 'n/a',
  'audioProfessional.value.yes': '是',
  'audioDrawer.todo.outputControls': '目标采样率和缓冲控制',
  'audioDrawer.todo.outputControlsDescription': 'TODO：等 DeviceService 暴露安全控制后接入真实音频设置。',
  'audioDrawer.troubleshooting.description': '如果声音卡住或设备列表不正常，点这里。软重启不会影响其他应用。',
  'audioDrawer.troubleshooting.hardAction': '重启 Windows 音频服务',
  'audioDrawer.troubleshooting.hardBusy': '正在重启 Windows 音频服务',
  'audioDrawer.troubleshooting.hardConfirm': '这会中断所有应用的声音（Chrome、游戏、通话），并需要管理员权限。是否继续？',
  'audioDrawer.troubleshooting.hardDone': 'Windows 音频服务已恢复，你可以重新开始播放',
  'audioDrawer.troubleshooting.softAction': '重启音频引擎',
  'audioDrawer.troubleshooting.softBusy': '正在重启音频引擎',
  'audioDrawer.troubleshooting.softDone': '音频引擎已重启，你可以重新开始播放',
  'audioDrawer.troubleshooting.title': '音频故障排除',
  'common.available': '可用',
  'common.build': '构建版',
  'common.checking': '检查中',
  'common.dev': '开发版',
  'common.disabled': '未启用',
  'common.enabled': '已启用',
  'common.loading': '加载中',
  'common.na': '无',
  'common.no': '否',
  'common.ready': '就绪',
  'common.unavailable': '暂不可用',
  'common.yes': '是',
  'library.action.refresh': '刷新',
  'library.albums.card.tracks': '{count} 首歌',
  'library.albums.confirm.deleteAlbumFiles': '删除专辑文件？\n{title}\n\n这会把 {count} 首歌曲移到系统回收站，并从媒体库移除。',
  'library.albums.error.coverNotSaved': '没有保存专辑封面。',
  'library.albums.error.desktopBridge': '桌面桥接不可用。请在 ECHO Next 桌面版中读取专辑。',
  'library.albums.error.noCopyableCover': '这张专辑没有可复制的封面。',
  'library.albums.error.noPlayableTracks': '这张专辑没有可播放的歌曲。',
  'library.albums.error.remoteEditUnsupported': '远程专辑暂不支持编辑标签或删除服务器文件。',
  'library.albums.listAria': '专辑列表',
  'library.albums.loading': '正在加载专辑...',
  'library.albums.searchPlaceholder': '搜索专辑 / 艺术家',
  'library.albums.sort.aria': '专辑排序',
  'library.albums.sort.artist': '艺术家',
  'library.albums.sort.titleAsc': '标题 A-Z',
  'library.albums.sort.titleDesc': '标题 Z-A',
  'library.albums.title': '专辑',
  'libraryDiagnostics.lab.description': '这些功能用于开发测试实时媒体库行为。默认关闭，不会影响普通用户。请只在测试分支或测试曲库中使用。',
  'library.artists.error.desktopBridge': '桌面桥接不可用。请在 ECHO Next 桌面版中读取艺术家。',
  'library.artists.avatarPriority': '头像优先',
  'library.artists.listAria': '艺术家列表',
  'library.artists.loading': '正在加载艺术家...',
  'library.artists.meta.albums': '{count} 张专辑',
  'library.artists.meta.noTracks': '暂无歌曲',
  'library.artists.meta.tracks': '{count} 首歌',
  'library.artists.searchPlaceholder': '搜索艺术家',
  'library.artists.sort.aria': '艺术家排序',
  'library.artists.sort.frequent': '歌曲最多',
  'library.artists.sort.nameAsc': '名称 A-Z',
  'library.artists.sort.nameDesc': '名称 Z-A',
  'library.artists.title': '艺术家',
  'artistDetail.action.addToQueue': '加入队列',
  'artistDetail.action.back': '艺术家',
  'artistDetail.action.playArtist': '播放艺术家',
  'artistDetail.action.readingArtist': '正在读取',
  'artistDetail.action.refreshInfo': '刷新信息',
  'artistDetail.action.shuffle': '随机播放',
  'artistDetail.albums.aria': '{artist} 的专辑',
  'artistDetail.albums.count': '{count} 张专辑',
  'artistDetail.albums.empty': '这个艺术家还没有归档专辑。',
  'artistDetail.albums.error.desktopBridge': '桌面桥接不可用。请在 ECHO Next 桌面版中读取艺术家专辑。',
  'artistDetail.albums.heading': '{artist} 的专辑',
  'artistDetail.albums.loadedCount': '已载入 {loaded}/{total} 张专辑',
  'artistDetail.aroundWeb.aria': '艺术家官网和社交媒体',
  'artistDetail.aroundWeb.heading': 'Around the web',
  'artistDetail.aria.details': '{artist} 艺术家详情',
  'artistDetail.aria.events': '艺术家演出',
  'artistDetail.aria.facts': '艺术家资料',
  'artistDetail.aria.metadata': '艺术家元数据',
  'artistDetail.aria.onlineSources': '在线艺术家来源',
  'artistDetail.aria.overview': '艺术家概览',
  'artistDetail.aria.relationshipMap': '艺术家关系图',
  'artistDetail.aria.sections': '{artist} 详情分区',
  'artistDetail.duration.hours': '已载入 {hours} 小时 {minutes} 分钟',
  'artistDetail.duration.minutes': '已载入 {minutes} 分钟',
  'artistDetail.duration.reading': '正在读取时长',
  'artistDetail.empty.relationships': '暂未找到本地一跳关系。',
  'artistDetail.error.desktopBridgeRead': '桌面桥接不可用。请在 ECHO Next 桌面版中读取这个艺术家。',
  'artistDetail.events.configureProviders': '演出信息需要配置 Bandsintown、Ticketmaster 或 SeatGeek 密钥；未配置时不会读取真实演出数据。',
  'artistDetail.events.collapse': '收起',
  'artistDetail.events.collapsedHint': '已找到 {count} 场演出，展开后查看日期、场馆和票务入口。',
  'artistDetail.events.count': '{count} 场演出',
  'artistDetail.events.expand': '展开',
  'artistDetail.events.noConcerts': '暂未匹配到近期演出。',
  'artistDetail.events.noConcertsRegion': '暂未在 {region} 匹配到近期演出。',
  'artistDetail.events.providerKeysRequired': '需要配置来源密钥',
  'artistDetail.events.venuePending': '场地待公布',
  'artistDetail.fact.albums': '专辑',
  'artistDetail.fact.loaded': '已载入',
  'artistDetail.fact.sources': '来源',
  'artistDetail.fact.tracks': '歌曲',
  'artistDetail.label.artist': '艺术家',
  'artistDetail.label.overview': '概览',
  'artistDetail.meta.albums': '{count} 张专辑',
  'artistDetail.meta.loadedTracks': '已载入 {loaded}/{total}',
  'artistDetail.meta.tracks': '{count} 首歌',
  'artistDetail.missing.description': '返回艺术家页并刷新曲库，即可查看最新目录。',
  'artistDetail.missing.title': '艺术家不存在或已从曲库移除。',
  'artistDetail.overview.about': '关于 {artist}',
  'artistDetail.overview.bioFallback': '来自你的本地曲库。在线艺术家信息会在后台轻量读取。',
  'artistDetail.relation.bpm': 'BPM',
  'artistDetail.relation.collaboration': '合作',
  'artistDetail.relation.evidence': '{label} / {evidence}',
  'artistDetail.relation.genre': '流派',
  'artistDetail.relation.history': '播放历史',
  'artistDetail.relation.link': '链接',
  'artistDetail.relation.local': '本地曲库信号',
  'artistDetail.relation.member': '成员',
  'artistDetail.relation.sameAlbum': '同专辑',
  'artistDetail.relation.similar': '相似',
  'artistDetail.section.concertInfo': '演出信息',
  'artistDetail.section.events': '演出',
  'artistDetail.section.localNetwork': '本地网络',
  'artistDetail.section.relationshipMap': '关系图',
  'artistDetail.status.collectedLocally': '本地收藏',
  'artistDetail.status.linkedArtists': '{count} 位关联艺术家',
  'artistDetail.status.loadingSignals': '正在读取本地信号',
  'artistDetail.status.localLibrary': '本地曲库',
  'artistDetail.status.readingRelationships': '正在读取艺术家关系...',
  'artistDetail.status.readySoon': '即将就绪',
  'artistDetail.tab.albums': '专辑',
  'artistDetail.tab.overview': '概览',
  'artistDetail.tab.songs': '歌曲',
  'artistDetail.tracks.action.addToQueueAria': '将 {title} 加入队列',
  'artistDetail.tracks.action.more': '更多',
  'artistDetail.tracks.action.moreAria': '{title} 的更多操作',
  'artistDetail.tracks.action.playNext': '下一首播放',
  'artistDetail.tracks.action.playNextAria': '下一首播放 {title}',
  'artistDetail.tracks.aria': '{artist} 的歌曲',
  'artistDetail.tracks.column.actions': '操作',
  'artistDetail.tracks.column.album': '专辑',
  'artistDetail.tracks.column.signal': '信号',
  'artistDetail.tracks.column.time': '时长',
  'artistDetail.tracks.column.title': '标题',
  'artistDetail.tracks.confirm.delete': '删除这个音乐文件？\n{title}',
  'artistDetail.tracks.empty': '这个艺术家还没有归档歌曲。',
  'artistDetail.tracks.error.actionUnavailable': '这个歌曲操作暂不可用。',
  'artistDetail.tracks.error.desktopBridgeActions': '桌面桥接不可用。请在 ECHO Next 桌面版中使用文件操作。',
  'artistDetail.tracks.error.desktopBridgeEdit': '桌面桥接不可用。请在 ECHO Next 桌面版中编辑内嵌标签。',
  'artistDetail.tracks.error.desktopBridgeRead': '桌面桥接不可用。请在 ECHO Next 桌面版中读取艺术家歌曲。',
  'artistDetail.tracks.expandAll': '全部展开',
  'artistDetail.tracks.error.noCoverSaved': '没有保存任何封面图。',
  'artistDetail.tracks.error.noCoverToCopy': '这首歌没有可复制的封面图。',
  'artistDetail.tracks.error.remoteFileAction': '远程歌曲暂不支持本地文件操作。',
  'artistDetail.tracks.formatAria': '歌曲格式',
  'artistDetail.tracks.heading': '{artist} 的歌曲',
  'artistDetail.tracks.loadedCount': '已载入 {loaded}/{total} 首歌',
  'artistDetail.tracks.loading': '正在加载歌曲...',
  'artistDetail.tracks.loadingTrack': '正在加载歌曲',
  'artistDetail.tracks.status.addedToPlaylist': '已加入歌单：{playlist}',
  'artistDetail.tracks.status.albumNotFound': '此艺术家视图中找不到专辑：{album}',
  'artistDetail.tracks.status.notInQueue': '播放队列中没有这首歌：{title}',
  'artistDetail.tracks.status.reloadedTags': '已从内嵌标签重新加载：{title}',
  'artistDetail.tracks.status.removedFromQueue': '已从播放队列移除：{title}',
  'artistDetail.tracks.unknownAlbum': '未知专辑',
  'library.count.total': '共 {count} 个',
  'library.sort.createdAsc': '创建最早',
  'library.sort.createdDesc': '创建最新',
  'library.sort.default': '默认',
  'library.sort.durationAsc': '时长最短',
  'library.sort.durationDesc': '时长最长',
  'library.sort.fileModifiedAsc': '文件修改最早',
  'library.sort.fileModifiedDesc': '文件修改最新',
  'library.sort.random': '随机',
  'library.sort.recent': '最近',
  'library.source.aria': '曲库来源',
  'library.source.local': '本地',
  'library.source.allRemote': '全部网盘来源',
  'library.source.remote': '网盘',
  'library.trackRow.action.addToPlaylist': '添加到歌单',
  'library.trackRow.action.addToPlaylistLabel': '添加到歌单 {title}',
  'library.trackRow.action.addToQueue': '加入队列',
  'library.trackRow.action.addToQueueLabel': '加入队列 {title}',
  'library.trackRow.action.download': '下载',
  'library.trackRow.action.downloadLabel': '下载 {title}',
  'library.trackRow.action.downloading': '下载中 {percent}%',
  'library.trackRow.action.downloadingLabel': '正在下载 {title} {percent}%',
  'library.trackRow.action.more': '更多',
  'library.trackRow.action.moreLabel': '更多 {title}',
  'library.trackRow.actions': '{title} 操作',
  'library.trackRow.audioSpecifications': '音频规格',
  'library.trackRow.duplicateVersions.count': '有 {count} 个版本',
  'library.trackRow.duplicateVersions.title': '查看重复歌曲版本',
  'library.trackRow.openAlbum': '打开专辑：{album}',
  'library.trackRow.openArtist': '打开艺术家：{artist}',
  'library.trackRow.status.playing': '播放中',
  'library.trackRow.status.unavailable': '不可用',
  'trackMenu.action.addToPlaylist': '加入歌单...',
  'trackMenu.action.playNext': '下一首播放',
  'trackMenu.action.addToQueue': '加入队列',
  'trackMenu.action.like': '喜欢',
  'trackMenu.action.unlike': '取消喜欢',
  'trackMenu.action.removeFromQueue': '从播放队列移除',
  'trackMenu.action.removeFromPlaylist': '从当前歌单移除',
  'trackMenu.action.openOsuTiming': 'osu! Timing',
  'trackMenu.action.editTags': '编辑标签',
  'trackMenu.action.reloadEmbeddedTags': '重新加载嵌入标签',
  'trackMenu.action.clearLyricsCache': '清理歌词缓存',
  'trackMenu.action.goToAlbum': '定位到专辑',
  'trackMenu.action.showInFolder': '在文件夹中显示',
  'trackMenu.action.copyPath': '复制文件路径',
  'trackMenu.action.openSystem': '使用系统默认应用打开',
  'trackMenu.action.copyNameArtist': '复制歌名与艺术家',
  'trackMenu.action.copyCover': '复制歌曲卡片图片',
  'trackMenu.action.saveCover': '保存歌曲卡片图片',
  'trackMenu.action.deleteSong': '删除歌曲',
  'folders.action.addScan': '添加并扫描',
  'folders.action.browse': '浏览',
  'folders.action.cancel': '取消',
  'folders.action.open': '打开',
  'folders.action.play': '播放',
  'folders.action.queue': '加入队列',
  'folders.action.random': '随机',
  'folders.action.refresh': '刷新文件夹',
  'folders.action.remove': '移除',
  'folders.action.scan': '扫描',
  'folders.confirm.deleteTrack': '删除这个音乐文件？\n{title}',
  'folders.confirm.removeRoot': '从曲库索引中移除“{name}”？音乐文件会保留在磁盘上。',
  'folders.count.tracks': '{count} 首',
  'folders.detail.importHint': '导入音乐文件夹后，可以按路径浏览曲库。',
  'folders.detail.libraryFolders': '曲库文件夹',
  'folders.detail.root': '根目录',
  'folders.detail.selectFolder': '选择文件夹',
  'folders.detail.subfolder': '子文件夹',
  'folders.duration.hours': '{count} 小时',
  'folders.duration.hoursMinutes': '{hours} 小时 {minutes} 分钟',
  'folders.duration.minutes': '{count} 分钟',
  'folders.empty.noScan': '这个根目录还没有运行过扫描。',
  'folders.empty.roots': '还没有曲库文件夹。',
  'folders.error.actionFailed': '文件夹操作失败。',
  'folders.error.desktopEditTags': '桌面桥接不可用。请在 ECHO Next 桌面端编辑内嵌标签。',
  'folders.error.desktopFileActions': '桌面桥接不可用。请在 ECHO Next 桌面端使用文件操作。',
  'folders.error.desktopImport': '桌面桥接不可用。请在 ECHO Next 桌面端导入文件夹。',
  'folders.error.desktopManage': '桌面桥接不可用。请在 ECHO Next 桌面端管理文件夹。',
  'folders.error.noCoverSaved': '没有保存任何封面。',
  'folders.error.noCoverToCopy': '这首歌没有可复制的封面。',
  'folders.error.notFolder': '选择的路径不是文件夹。',
  'folders.error.pathMissing': '文件夹路径不存在。',
  'folders.error.permission': 'ECHO 没有权限访问这个文件夹。',
  'folders.error.trackActionUnavailable': '这个歌曲操作暂不可用。',
  'folders.filters.includeSubfolders': '包含子文件夹',
  'folders.filters.label': '文件夹歌曲筛选',
  'folders.filters.searchPlaceholder': '搜索此文件夹...',
  'folders.message.addedToPlaylist': '已添加到歌单：{name}',
  'folders.message.alreadyScanning': '这个曲库根目录正在扫描。',
  'folders.message.folderAddedScanStarted': '文件夹已添加，扫描已在后台开始。',
  'folders.message.folderRemoved': '文件夹已从曲库索引中移除。',
  'folders.message.loadedPartial': '已载入前 {loaded} / {total} 首，避免占用过多内存。',
  'folders.message.loadedTracks': '已载入 {count} 首。',
  'folders.message.noPlayableTracks': '这个文件夹里没有可播放歌曲。',
  'folders.message.queuedTracks': '已加入队列 {count} 首。',
  'folders.message.scanCancelled': '扫描已取消。',
  'folders.message.scanStarted': '扫描已开始。',
  'folders.metrics.duration': '时长',
  'folders.metrics.label': '文件夹指标',
  'folders.metrics.size': '大小',
  'folders.metrics.subfolders': '子文件夹',
  'folders.metrics.tracks': '歌曲',
  'folders.panel.addFolder': '添加文件夹',
  'folders.panel.import': '导入',
  'folders.panel.manage': '管理',
  'folders.panel.scan': '扫描',
  'folders.panel.selectedRoot': '已选根目录',
  'folders.panel.status': '状态',
  'folders.phase.checkingCache': '检查缓存',
  'folders.phase.discovering': '查找文件',
  'folders.phase.extractingCovers': '提取封面',
  'folders.phase.finished': '已完成',
  'folders.phase.groupingAlbums': '整理专辑',
  'folders.phase.readingMetadata': '读取标签',
  'folders.phase.writingDatabase': '写入数据库',
  'folders.prompt.choosePlaylist': '选择歌单编号：\n{names}',
  'folders.prompt.createPlaylist': '还没有歌单。输入名称来创建一个：',
  'folders.queueSource.recursive': '{name} 文件夹',
  'folders.scan.progress': '{processed}/{total} 个文件，{errors} 个错误',
  'folders.sidebar.kicker': '曲库',
  'folders.sidebar.title': '文件夹',
  'folders.sort.album': '专辑',
  'folders.sort.artist': '艺术家',
  'folders.sort.duration': '时长',
  'folders.sort.quality': '音质',
  'folders.sort.random': '随机',
  'folders.sort.recent': '最近更新',
  'folders.sort.title': '标题',
  'folders.status.cancelled': '已取消',
  'folders.status.completed': '完成',
  'folders.status.failed': '失败',
  'folders.status.queued': '排队中',
  'folders.status.running': '扫描中',
  'folders.statusLine.loadingTracks': '正在读取文件夹歌曲...',
  'folders.statusLine.preparingQueue': '正在准备文件夹队列...',
  'notice.browserFolderPicker': '浏览器预览已打开文件夹选择器。真实曲库导入需要使用 Electron 桌面应用。',
  'notice.browserFilePicker': '浏览器预览已选择 {name}。请在 ECHO Next 桌面端通过 Audio Core 播放。',
  'notice.windowControlsDesktop': '窗口控制只在 Electron 桌面窗口中可用。',
  'notice.accountExpired': '账号登录状态可能已失效：{names}。请到设置 > 集成重新登录。',
  'notice.accountExpired.title': '账号登录失效',
  'notice.action.close': '关闭',
  'notice.action.closeNotice': '关闭提示',
  'notice.action.ignore': '忽略',
  'notice.action.openReport': '打开报告',
  'notice.audioError.description': '已生成 Markdown 诊断报告，里面有详细原因和排查线索。',
  'notice.audioError.title': '音频错误',
  'notice.audioDefaultFormatWarning': '音频设置提醒：Windows 默认格式设置偏高，当前是 {rate}。ECHO 只会提醒，不会修改系统设置；建议改到 48 kHz。',
  'notice.diagnosticsCrash.description': '上次 ECHO Next 没有正常退出，已准备 Markdown 报告用于排查。',
  'notice.importFiles.empty': '没有可导入的音频文件。',
  'notice.importFiles.failed': '{count} 个文件导入失败',
  'notice.importFiles.imported': '已入库 {count} 个文件',
  'notice.importFiles.skipped': '忽略 {count} 个不支持或不可用文件',
  'notice.openFiles.partial': '已打开 {opened} 个文件，忽略 {rejected} 个不支持或不可用文件。',
  'notice.reportOpened': 'Markdown 报告已打开。',
  'notice.reportOpenedPath': 'Markdown 报告已打开：{path}',
  'notice.updateAvailable': '发现 ECHO NEXT 新版本。',
  'notice.updateAvailableVersion': '发现 ECHO NEXT 新版本 {version}。',
  'notice.updateDownloaded': 'ECHO NEXT 更新已下载完成，准备安装。',
  'notice.updateDownloadedVersion': 'ECHO NEXT {version} 已下载完成，准备安装。',
  'punctuation.clauseSeparator': '，',
  'punctuation.listSeparator': '、',
  'queue.action.clear': '清空队列',
  'queue.action.dragLabel': '拖拽 {title}',
  'queue.action.dragTitle': '拖拽排序',
  'queue.action.generateFromHistory': '按历史生成队列',
  'queue.action.generateRandom': '生成随机队列',
  'queue.action.generatingHistory': '生成中',
  'queue.action.generatingRandom': '生成中',
  'queue.action.autoFill': '自动补齐队列',
  'queue.action.like': '喜欢',
  'queue.action.more': '更多',
  'queue.action.openFolder': '打开所在文件夹',
  'queue.action.play': '立即播放 {title}',
  'queue.action.playNext': '下一首播放 {title}',
  'queue.action.remove': '移除 {title}',
  'queue.action.shuffle': '随机播放',
  'queue.count': '{count} 首',
  'queue.empty.description': '播放歌曲、加入队列或选择下一首播放后，这里会出现队列内容。',
  'queue.empty.title': '还没有接下来播放的歌曲',
  'queue.error.desktopBridge': '桌面桥接不可用。请在 ECHO Next 桌面端读取曲库。',
  'queue.error.noHistoryTracks': '还没有可用于生成队列的播放历史。',
  'queue.error.noRandomTracks': '曲库里还没有可加入随机队列的歌曲。',
  'queue.header.kicker': '播放队列',
  'queue.header.title': '队列',
  'queue.historySource': '历史常听',
  'queue.now.actions': '当前曲目操作',
  'queue.now.emptyDescription': '从歌曲或专辑开始播放后，这里会显示当前曲目。',
  'queue.now.emptyTitle': '还没有正在播放的歌曲',
  'queue.now.kicker': '正在播放',
  'queue.now.quality': '音频质量',
  'queue.now.sourceFallback': '队列',
  'queue.now.waitingAudio': '等待音频信息',
  'queue.quality.unknown': '未知',
  'queue.randomSource': '随机队列',
  'queue.repeat.all': '队列',
  'queue.repeat.mode': '循环模式',
  'queue.repeat.off': '关闭',
  'queue.repeat.one': '单曲',
  'queue.tools': '队列工具',
  'queue.upNext.kicker': '接下来',
  'queue.upNext.title': '接下来播放',
  'queue.upNext.waitingCount': '{count} 首等待',
  'queue.unknownAlbum': '未知专辑',
  'queue.unknownArtist': '未知艺术家',
  'route.albums.description': '按专辑分组的封面墙。',
  'route.albums.label': '专辑',
  'route.artists.description': '按艺术家浏览。',
  'route.artists.label': '艺术家',
  'route.audioSettings.description': '输出与解码设置。',
  'route.audioSettings.label': '音频设置',
  'route.connect.description': 'DLNA / AirPlay 无线播放。',
  'route.connect.label': '连接',
  'route.dsp.description': '信号链调音工作台。',
  'route.dsp.label': 'DSP',
  'connectPage.controls.aria': 'Connect 控制',
  'connectPage.controls.disconnect': '断开',
  'connectPage.controls.pause': '暂停',
  'connectPage.controls.play': '播放',
  'connectPage.controls.stop': '停止',
  'connectPage.controls.volume': '投送音量',
  'connectPage.deviceState.available': '可用',
  'connectPage.deviceState.connected': '已连接',
  'connectPage.deviceState.unavailable': '离线',
  'connectPage.deviceState.unsupported': '实验',
  'connectPage.devices.allHidden': '当前设备都已隐藏',
  'connectPage.devices.aria': '设备列表',
  'connectPage.devices.collapse': '折叠局域网数播',
  'connectPage.devices.empty': '未发现局域网设备',
  'connectPage.devices.emptyHint': '刷新后会在这里显示数播、TV、HQPlayer 和 AirPlay 入口。',
  'connectPage.devices.expand': '展开局域网数播',
  'connectPage.devices.hiddenAria': '隐藏的局域网设备',
  'connectPage.devices.hiddenTitle': '已隐藏设备',
  'connectPage.devices.kicker': 'NETWORK STREAMERS',
  'connectPage.devices.restoreAll': '全部恢复',
  'connectPage.devices.restoreHint': '可在上方恢复隐藏设备。',
  'connectPage.devices.summary': '{streamers} 台数播 · {entries} 个入口 · 已隐藏 {hidden}',
  'connectPage.devices.title': '局域网数播',
  'connectPage.header.autoStart': '启动时自动开启 AirPlay / DLNA',
  'connectPage.header.description': 'DLNA / AirPlay / HQPlayer 外部播放集中管理；HQPlayer 当前以安全交接预演为主。',
  'connectPage.header.kicker': 'WIRELESS PLAYBACK',
  'connectPage.header.refresh': '刷新设备',
  'connectPage.hqplayer.enable': '启用 HQPlayer',
  'connectPage.hqplayer.kicker': 'EXTERNAL RENDERER',
  'connectPage.hqplayer.localDesktop': '本机 HQPlayer Desktop',
  'connectPage.hqplayer.state.available': '可连接',
  'connectPage.hqplayer.state.checking': '检测中',
  'connectPage.hqplayer.state.disabled': '未启用',
  'connectPage.hqplayer.state.notConfigured': '未配置端口',
  'connectPage.hqplayer.state.unavailable': '不可用',
  'connectPage.hqplayer.test': '检测 HQPlayer',
  'connectPage.nowPlaying.aria': '当前投送',
  'connectPage.nowPlaying.chooseDevice': '选择一台局域网数播后开始投送',
  'connectPage.nowPlaying.coverReady': '封面 URL 已发送',
  'connectPage.nowPlaying.coverWaiting': '等待封面 URL',
  'connectPage.nowPlaying.dlnaPolling': '状态轮询约 3s',
  'connectPage.nowPlaying.emptyTitle': '没有当前歌曲',
  'connectPage.nowPlaying.infoAria': '当前投送信息',
  'connectPage.nowPlaying.infoWaiting': '等待投送信息',
  'connectPage.nowPlaying.latency': '投送握手 {ms}ms',
  'connectPage.nowPlaying.noOutput': '未连接输出',
  'connectPage.nowPlaying.progressAria': '投送进度',
  'connectPage.outgoing.aria': 'DLNA outgoing request log',
  'connectPage.outgoing.empty': 'No pulls yet',
  'connectPage.outgoing.note': '设备拉取封面或音频后会显示在这里',
  'connectPage.outgoing.recent': '{count} recent',
  'connectPage.outgoing.title': 'DLNA Out',
  'connectPage.receiver.aria': '接收来自手机',
  'connectPage.receiver.disable': '关闭接收',
  'connectPage.receiver.discoveryHint': '开启后手机可发现',
  'connectPage.receiver.enable': '开启接收',
  'connectPage.receiver.fromClient': '来自 {address}',
  'connectPage.receiver.kicker': 'RECEIVER',
  'connectPage.receiver.noClient': '未连接手机',
  'connectPage.receiver.preparing': '正在准备局域网地址',
  'connectPage.receiver.progressAria': '接收播放进度',
  'connectPage.receiver.state.disabled': '未开启',
  'connectPage.receiver.state.idle': '等待手机',
  'connectPage.receiver.state.loading': '加载中',
  'connectPage.receiver.state.playing': '手机投送中',
  'connectPage.receiver.state.ready': '已接收媒体',
  'connectPage.receiver.stop': '停止接收播放',
  'connectPage.receiver.title': '接收来自手机',
  'connectPage.receiver.waitingTitle': '等待手机投送',
  'connectPage.stage.aria': '快速投送',
  'connectPage.state.connecting': '连接中',
  'connectPage.state.discovering': '扫描设备',
  'connectPage.state.error': '错误',
  'connectPage.state.idle': '待机',
  'connectPage.state.paused': '已暂停',
  'connectPage.state.playing': '投送中',
  'connectPage.state.stopped': '已停止',
  'connectPage.airplay.state.idle': '等待 iPhone',
  'connectPage.airplay.state.playing': 'AirPlay 播放中',
  'connectPage.airplay.state.starting': '启动中',
  'connectPage.airplay.state.unavailable': '原生后端不可用',
  'connectPage.airplay.waitingTitle': '等待 iPhone 投送',
  'route.downloads.description': '下载任务占位。',
  'route.downloads.label': '下载',
  'route.folders.description': '本地导入根目录。',
  'route.folders.label': '文件夹',
  'route.history.description': '播放历史。',
  'route.history.label': '历史',
  'historyPage.action.clear': '清空历史',
  'historyPage.action.refreshInvalid': '刷新失效歌曲',
  'historyPage.confirm.clear': '清空播放历史？这不会删除你的音乐文件，也不会清空曲库。',
  'historyPage.date.none': '暂无',
  'historyPage.duration.hoursMinutes': '{hours} 小时 {minutes} 分钟',
  'historyPage.duration.minutes': '{count} 分钟',
  'historyPage.empty.description': '播放一首歌后，这里会记录你的最近收听。',
  'historyPage.empty.title': '还没有播放历史。',
  'historyPage.error.desktopBridgeRead': 'Desktop bridge unavailable. Open ECHO Next in Electron to read playback history.',
  'historyPage.filter.all': '全部',
  'historyPage.filter.completed': '只看完整播放',
  'historyPage.filter.month': '本月',
  'historyPage.filter.today': '今天',
  'historyPage.filter.week': '本周',
  'historyPage.header.kicker': '最近播放记录',
  'historyPage.header.title': '历史',
  'historyPage.list.aria': '播放历史列表',
  'historyPage.list.doubleClick': '双击播放',
  'historyPage.list.source': '来自 {source}',
  'historyPage.list.unknownAlbum': '未知专辑',
  'historyPage.list.unknownArtist': '未知艺术家',
  'historyPage.list.unknownSource': '来源未知',
  'historyPage.loadMore': '加载更多',
  'historyPage.loading': '正在读取播放历史...',
  'historyPage.loadingMore': '正在加载...',
  'historyPage.metric.plays': '{count} 次',
  'historyPage.metric.tracks': '{count} 首',
  'historyPage.refresh.none': '没有发现失效历史歌曲。',
  'historyPage.refresh.removed': '已移除 {count} 首失效历史歌曲。',
  'historyPage.refresh.running': '正在刷新...',
  'historyPage.recent.aria': '最近播放列表',
  'historyPage.recent.count': '最近 {count} 首',
  'historyPage.recent.empty': '暂无最近播放。',
  'historyPage.recent.kicker': '按时间排序',
  'historyPage.recent.title': '最近播放列表',
  'historyPage.search.placeholder': '搜索标题、艺术家、专辑或路径',
  'historyPage.summary.all.count': '总播放',
  'historyPage.summary.all.duration': '总时长',
  'historyPage.summary.all.group': '按播放次数排序',
  'historyPage.summary.all.latest': '最近播放时间',
  'historyPage.summary.all.tracks': '历史曲目',
  'historyPage.summary.aria': '历史概览',
  'historyPage.summary.completed.count': '完整播放',
  'historyPage.summary.completed.duration': '完整播放时长',
  'historyPage.summary.completed.group': '按完整播放次数排序',
  'historyPage.summary.completed.latest': '最近完整播放',
  'historyPage.summary.completed.tracks': '完整播放曲目',
  'historyPage.summary.month.count': '本月播放',
  'historyPage.summary.month.duration': '本月时长',
  'historyPage.summary.month.group': '本月按播放次数排序',
  'historyPage.summary.month.latest': '本月最近播放',
  'historyPage.summary.month.tracks': '本月曲目',
  'historyPage.summary.today.count': '今日播放',
  'historyPage.summary.today.duration': '今日时长',
  'historyPage.summary.today.group': '今日按播放次数排序',
  'historyPage.summary.today.latest': '今日最近播放',
  'historyPage.summary.today.tracks': '今日曲目',
  'historyPage.summary.week.count': '本周播放',
  'historyPage.summary.week.duration': '本周时长',
  'historyPage.summary.week.group': '本周按播放次数排序',
  'historyPage.summary.week.latest': '本周最近播放',
  'historyPage.summary.week.tracks': '本周曲目',
  'historyPage.toolbar.aria': '历史筛选',
  'route.home.description': '曲库概览与最近聆听。',
  'route.home.label': '主页',
  'home.artistLeaderboard.aria': '艺人排行榜',
  'home.artistLeaderboard.completionRate': '{rate}% 完播',
  'home.artistLeaderboard.emptyDescription': '播放更多音乐后，这里会形成你的高频艺人榜。',
  'home.artistLeaderboard.emptyTitle': '还没有艺人排行',
  'home.artistLeaderboard.playCount': '{count} 次',
  'home.artistLeaderboard.title': '艺人排行榜',
  'home.count.tracks': '{count} 首',
  'home.date.none': '还没有记录',
  'home.date.unknown': '时间未知',
  'home.duration.hoursMinutes': '{hours} 小时 {minutes} 分钟',
  'home.duration.hoursOnly': '{hours} 小时',
  'home.duration.minutes': '{count} 分钟',
  'home.duration.zeroMinutes': '0 分钟',
  'home.error.albumNotFound': '未找到专辑：{album}',
  'home.error.artistNotFound': '未找到艺术家：{artist}',
  'home.error.desktopBridgeRandom': '桌面曲库桥接不可用。请在 ECHO Next 桌面端生成随机队列。',
  'home.error.desktopBridgeRecommend': '桌面曲库桥接不可用。请在 ECHO Next 桌面端刷新推荐。',
  'home.error.desktopBridgeView': '桌面曲库桥接不可用。请在 ECHO Next 桌面端查看主页。',
  'home.favoriteAlbums.aria': '你喜欢的专辑',
  'home.favoriteAlbums.emptyDescription': '播放更多专辑后，这里会按听过最多次数选出前四张。',
  'home.favoriteAlbums.emptyTitle': '还没有常听专辑',
  'home.favoriteAlbums.title': '你喜欢的专辑',
  'home.hero.action.continue': '继续播放',
  'home.hero.action.viewQueue': '查看队列',
  'home.hero.aria': '今日回声',
  'home.hero.defaultTitle': '从你的音乐库开始播放。',
  'home.hero.description.empty': '导入音乐后，这里会变成你的曲库入口、最近播放和本周聆听脉冲。',
  'home.hero.description.resume': '接上 {artist} 的「{title}」，或者从最近入库里挑一张封面开始。',
  'home.hero.kicker': '今日回声',
  'home.hero.nowPlaying': '正在播放',
  'home.hero.recentSignal': '最近信号',
  'home.hero.statsAria': '曲库统计',
  'home.metric.albums': '专辑',
  'home.metric.albumsDetail': '按作品聚合',
  'home.metric.artists': '艺术家',
  'home.metric.folders': '文件夹',
  'home.metric.foldersDetail': '最近扫描 {date}',
  'home.metric.openAria': '打开{label}',
  'home.metric.songs': '歌曲',
  'home.metric.songsDetail': '总时长 {duration}',
  'home.month.label': '{month}月',
  'home.nowMeta.empty': '曲库准备好后会显示最近内容',
  'home.preferences.aria': '播放偏好',
  'home.recent.emptyAddedDescription': '导入文件夹后，这里会显示最新进入曲库的封面。',
  'home.recent.emptyAddedTitle': '还没有最近入库',
  'home.recent.emptyPlayedDescription': '开始播放后，这里会出现最近听过的专辑。',
  'home.recent.emptyPlayedTitle': '还没有最近播放',
  'home.recent.nextPage': '下一页',
  'home.recent.prevPage': '上一页',
  'home.recent.tab.added': '添加于',
  'home.recent.tab.played': '已播放',
  'home.recent.tabsAria': '最近内容',
  'home.recent.title': '最近活动',
  'home.recommend.emptyDescription': '导入专辑后，这里会直接铺满你的专辑。',
  'home.recommend.emptyTitle': '还没有可推荐专辑',
  'home.recommend.refresh': '刷新',
  'home.recommend.refreshing': '刷新中',
  'home.recommend.title': '为你推荐',
  'home.signalVisualizer.aria': '音频可视化',
  'home.status.loading': '正在整理主页...',
  'home.week.emptyHint': '播放后，格子会按每周节奏被点亮。',
  'home.week.listenDuration': '聆听时长',
  'home.week.playCount': '本周播放',
  'home.week.times': '次',
  'home.week.title': '本周回声',
  'home.weekday.fri': '五',
  'home.weekday.mon': '一',
  'home.weekday.wed': '三',
  'home.weeklyHeatmap.activeWeeks': '{count} 周活跃',
  'home.weeklyHeatmap.aria': '近 {weeks} 周播放热力图',
  'home.weeklyHeatmap.dayAria': '{date}，{playCount} 次播放',
  'home.weeklyHeatmap.dayTitle': '{date} · {playCount} 次 · {duration}',
  'route.inbox.description': '每次扫描新增歌曲。',
  'route.inbox.label': '收件箱',
  'inboxPage.action.addToQueue': '加入队列',
  'inboxPage.action.generatePlaylist': '生成待听歌单',
  'inboxPage.batch.latest': '最新扫描',
  'inboxPage.batch.recentAll': '最近全部扫描',
  'inboxPage.batch.selected': '指定扫描',
  'inboxPage.date.none': '尚无记录',
  'inboxPage.empty.description': '完成一次曲库扫描后，这里会出现新增歌曲。',
  'inboxPage.empty.noMatch': '没有匹配的新歌',
  'inboxPage.empty.title': '还没有新增记录',
  'inboxPage.empty.tryFilter': '换个筛选条件再看看。',
  'inboxPage.error.desktopBridgeRead': '桌面桥接暂不可用，无法读取新歌收件箱。',
  'inboxPage.facets.allAlbums': '全部专辑',
  'inboxPage.facets.allArtists': '全部艺人',
  'inboxPage.facets.allFolders': '全部文件夹',
  'inboxPage.facets.aria': '新歌收件箱维度筛选',
  'inboxPage.filter.all': '全部新增',
  'inboxPage.filter.aria': '问题分类筛选',
  'inboxPage.filter.clear': '清空筛选',
  'inboxPage.filter.metadataIssue': '资料异常',
  'inboxPage.filter.missingCover': '缺封面',
  'inboxPage.filter.suspiciousFile': '疑似异常',
  'inboxPage.filter.unknownAlbum': '未知专辑',
  'inboxPage.filter.unknownArtist': '未知艺人',
  'inboxPage.hero.kicker': 'LIBRARY INBOX',
  'inboxPage.loading': '正在读取收件箱...',
  'inboxPage.processing.aria': '本批待处理',
  'inboxPage.processing.pending': '待听 / 待处理',
  'inboxPage.quality.aria': '入库质量摘要',
  'inboxPage.quality.coverCompleteness': '封面完整率',
  'inboxPage.quality.metadataCompleteness': '资料完整率',
  'inboxPage.quality.unknownArtistAlbum': '未知艺人 / 专辑',
  'inboxPage.search.aria': '搜索新歌收件箱',
  'inboxPage.search.placeholder': '搜索标题、艺人、专辑、路径',
  'inboxPage.stats.aria': '新歌收件箱摘要',
  'inboxPage.stats.currentResults': '当前结果',
  'inboxPage.stats.newSongs': '新增歌曲',
  'inboxPage.status.all': '全部状态',
  'inboxPage.status.aria': '处理状态筛选',
  'inboxPage.status.ignored': '已忽略',
  'inboxPage.status.pending': '待处理',
  'inboxPage.status.processed': '已处理',
  'inboxPage.story.aria': '入库故事',
  'inboxPage.story.clean': '{summary}。资料看起来很干净。',
  'inboxPage.story.empty': '完成一次扫描后，ECHO 会把新增歌曲、专辑和资料问题整理在这里。',
  'inboxPage.story.kicker': 'IMPORT STORY',
  'inboxPage.story.newAlbums': '新增专辑',
  'inboxPage.story.newArtists': '新增艺人',
  'inboxPage.story.summaryAlbums': '{count} 张专辑',
  'inboxPage.story.summaryArtists': '{count} 位艺人',
  'inboxPage.story.summaryTracks': '{scope}新增 {count} 首',
  'inboxPage.story.totalDuration': '总时长',
  'inboxPage.story.warningMetadataIssue': '{count} 首资料异常',
  'inboxPage.story.warningMissingCover': '{count} 首缺封面',
  'inboxPage.story.withWarnings': '{summary}。其中 {warnings}。',
  'inboxPage.toolbar.aria': '新歌收件箱筛选',
  'inboxPage.toolbar.batch': '批次',
  'route.importFile.description': '导入单个音频文件。',
  'route.importFile.label': '导入文件',
  'route.importFolder.description': '选择本地音乐文件夹。',
  'route.importFolder.label': '导入文件夹',
  'importFolder.hero.note': '此页面只用于本地曲库导入和扫描状态查看。',
  'nowPlaying.action.openLyrics': '打开歌词',
  'nowPlaying.description': '当前曲目概览。歌词请从底部播放器的麦克风按钮进入独立页面。',
  'nowPlaying.emptyDescription': '从歌曲列表或专辑开始播放后，这里会显示当前曲目。',
  'nowPlaying.emptyTitle': '暂无播放',
  'nowPlaying.kicker': '正在播放',
  'nowPlaying.localFile': '本地文件',
  'nowPlaying.ready': '就绪',
  'nowPlaying.state.idle': '空闲',
  'nowPlaying.state.playing': '播放中',
  'nowPlaying.title': '正在播放',
  'route.liked.description': '收藏曲目。',
  'route.liked.label': '喜欢',
  'route.lyrics.description': '歌词与沉浸播放。',
  'route.lyrics.label': '歌词',
  'route.lyricsSettings.description': '歌词偏好设置。',
  'route.lyricsSettings.label': '歌词设置',
  'lyricsSettings.action.choose': '选择',
  'lyricsSettings.action.fonts': '字体',
  'lyricsSettings.action.match': '匹配',
  'lyricsSettings.action.music': '音乐',
  'lyricsSettings.action.reset': '重置',
  'lyricsSettings.action.search': '搜索',
  'lyricsSettings.background.blur': '背景模糊度',
  'lyricsSettings.background.brightness': '背景亮度',
  'lyricsSettings.background.chooseWallpaper': '选择自定义壁纸',
  'lyricsSettings.background.clearWallpaper': '清除自定义壁纸',
  'lyricsSettings.background.clearWallpaperHint': '恢复为跟随主题',
  'lyricsSettings.background.highResolutionCover': '请求网络元数据的高清封面',
  'lyricsSettings.background.highResolutionCoverDescription': '仅在跟随封面时临时请求高清封面作为歌词背景；关闭时只使用本地封面兜底。',
  'lyricsSettings.background.mode.cover': '跟随封面',
  'lyricsSettings.background.mode.coverColor': '封面取色',
  'lyricsSettings.background.mode.customWallpaper': '自定义壁纸',
  'lyricsSettings.background.mode.theme': '跟随主题',
  'lyricsSettings.background.modeAria': '歌词背景模式',
  'lyricsSettings.background.modeDescription': '封面模式会使用当前歌曲封面；封面取色只提取当前封面主色；自定义壁纸会保存到应用数据目录。',
  'lyricsSettings.background.opacity': '背景透明度',
  'lyricsSettings.background.readability': '歌词可读性增强',
  'lyricsSettings.background.readabilityDescription': '为沉浸式 MV 背景上的歌词增加描边和投影；不用展开沉浸式 MV 背景设置也可以常驻开关。',
  'lyricsSettings.background.scale': '背景放大',
  'lyricsSettings.background.showControls': '显示歌词背景设置',
  'lyricsSettings.background.smartReadable': '智能可读颜色',
  'lyricsSettings.background.smartReadableDescription': '根据封面、壁纸或 MV 画面自动选择高对比文字色，并按需增加轻遮罩、描边和阴影。关闭时继续使用手动歌词颜色。',
  'lyricsSettings.background.title': '歌词背景',
  'lyricsSettings.background.tuning': '背景调节',
  'lyricsSettings.background.tuningDescription': '跟随封面和自定义壁纸都会使用这里的透明度、模糊度和亮度。',
  'lyricsSettings.background.wallpaperSaved': '已保存到应用壁纸目录',
  'lyricsSettings.candidate.allSources': '全部来源',
  'lyricsSettings.candidate.results': '歌词搜索结果',
  'lyricsSettings.candidate.risk.high': '需要确认',
  'lyricsSettings.candidate.risk.low': '精准匹配',
  'lyricsSettings.candidate.risk.medium': '可能匹配',
  'lyricsSettings.candidate.reason.albumMatch': '专辑匹配',
  'lyricsSettings.candidate.reason.artistExact': '艺人一致',
  'lyricsSettings.candidate.reason.artistMismatch': '艺人不符',
  'lyricsSettings.candidate.reason.autoAccept': '自动采用',
  'lyricsSettings.candidate.reason.candidateOnlyCover': '翻唱需确认',
  'lyricsSettings.candidate.reason.candidateOnlyDuration': '时长需确认',
  'lyricsSettings.candidate.reason.coverIntent': '翻唱候选',
  'lyricsSettings.candidate.reason.durationClose': '时长接近',
  'lyricsSettings.candidate.reason.durationExact': '时长精准',
  'lyricsSettings.candidate.reason.durationMismatch': '时长不符',
  'lyricsSettings.candidate.reason.embeddedTag': '内嵌歌词',
  'lyricsSettings.candidate.reason.localSidecar': '本地歌词',
  'lyricsSettings.candidate.reason.rejectedByUser': '已拒绝',
  'lyricsSettings.candidate.reason.syncedDurationSafe': '同步安全',
  'lyricsSettings.candidate.reason.titleExact': '标题一致',
  'lyricsSettings.candidate.reason.titleSimilar': '标题接近',
  'lyricsSettings.candidate.reason.versionConflict': '版本冲突',
  'lyricsSettings.candidate.reason.versionMatch': '版本匹配',
  'lyricsSettings.candidate.sourceFilters': '歌词来源筛选',
  'lyricsSettings.candidate.type.instrumental': '纯音乐',
  'lyricsSettings.candidate.type.lyrics': '歌词',
  'lyricsSettings.candidate.type.plain': '纯文本',
  'lyricsSettings.candidate.type.synced': '逐行同步',
  'lyricsSettings.currentTrack.instrumentalMarked': '已标记为纯音乐',
  'lyricsSettings.currentTrack.markInstrumental': '标记为纯音乐',
  'lyricsSettings.currentTrack.markInstrumentalHint': '记忆当前歌曲并停止自动歌词匹配',
  'lyricsSettings.currentTrack.rematch': '重新匹配',
  'lyricsSettings.currentTrack.rematchHint': '清理当前缓存并重新查找',
  'lyricsSettings.currentTrack.restartOnApply': '应用歌词后自动重播音乐',
  'lyricsSettings.currentTrack.restartOnApplyDescription': '默认关闭；开启后，成功应用当前歌曲歌词时会从头播放，避免歌词时间轴沿用旧进度导致不同步。',
  'lyricsSettings.currentTrack.searchHint': '留空则使用当前歌曲信息',
  'lyricsSettings.currentTrack.searchInput': '搜索歌词文本',
  'lyricsSettings.currentTrack.searchLyrics': '搜索歌词',
  'lyricsSettings.currentTrack.searchPlaceholder': '歌名 / 艺术家 / 关键词',
  'lyricsSettings.currentTrack.title': '当前歌曲',
  'lyricsSettings.display.autoOpenCandidatePanel': '自动弹出歌词选择栏',
  'lyricsSettings.display.chooseMiniPlayerColor': '选择底栏颜色',
  'lyricsSettings.display.coverMiniPlayerHint': '会从当前歌曲封面提取颜色，并自动压暗成适合按钮阅读的玻璃色。',
  'lyricsSettings.display.customColor': '自定义颜色',
  'lyricsSettings.display.defaultMicrosoftYahei': '默认微软雅黑，可换系统字体',
  'lyricsSettings.display.desktopFont': '桌面歌词字体',
  'lyricsSettings.display.desktopLyrics': '桌面歌词',
  'lyricsSettings.display.desktopLyricsDescription': '开启后用独立透明窗口在桌面置顶显示当前歌词。',
  'lyricsSettings.display.desktopOpacity': '桌面歌词透明度',
  'lyricsSettings.display.desktopOpacityDescription': '当前 {opacity}%，调低可减少遮挡。',
  'lyricsSettings.display.desktopRomanization': '桌面歌词显示罗马音',
  'lyricsSettings.display.desktopTranslation': '桌面歌词显示翻译',
  'lyricsSettings.display.disableMvTrackInfoAutoShow': '关闭MV自动显示歌曲信息',
  'lyricsSettings.display.enableLyrics': '启用歌词',
  'lyricsSettings.display.enableLyricsDescription': '关闭后歌词页不会加载、搜索或匹配歌词。',
  'lyricsSettings.display.hideEmptyState': '隐藏纯音乐提示',
  'lyricsSettings.display.hideEmptyStateDescription': '隐藏歌词页中央的“纯音乐，请欣赏”和“暂无歌词”提示，默认开启。',
  'lyricsSettings.display.hideTrackInfo': '隐藏歌曲信息',
  'lyricsSettings.display.lockDesktopLyrics': '锁定桌面歌词',
  'lyricsSettings.display.lockDesktopLyricsDescription': '锁定后鼠标会穿透桌面歌词，避免挡住桌面操作；回到这里可解锁。',
  'lyricsSettings.display.matchThreshold': '歌词匹配度设置',
  'lyricsSettings.display.matchThresholdDescription': '在线结果达到 {threshold}% 才会自动应用',
  'lyricsSettings.display.miniPlayer': '迷你底栏',
  'lyricsSettings.display.miniPlayerAutoHide': '自动隐藏迷你底栏',
  'lyricsSettings.display.miniPlayerAutoHideDescription': '开启后鼠标离开底栏一段距离会自动收起；移回底部附近会顺滑显示，默认关闭。',
  'lyricsSettings.display.miniPlayerAutoMv': '播放 MV 时自动启用',
  'lyricsSettings.display.miniPlayerAutoMvDescription': '开启后进入 MV 页面会自动使用迷你底栏；普通歌词页仍按上方开关决定。',
  'lyricsSettings.display.miniPlayerColor': '底栏颜色',
  'lyricsSettings.display.miniPlayerColorMode': '迷你底栏颜色模式',
  'lyricsSettings.display.miniPlayerDefaultDark': '默认深色',
  'lyricsSettings.display.miniPlayerDescription': '开启后歌词页会隐藏默认底部播放栏，改用贴在底部中央的小号控制条。',
  'lyricsSettings.display.miniPlayerHint': '默认开启；适合想保留歌词沉浸感、但仍要快速切歌和拖动进度时使用。',
  'lyricsSettings.display.miniPlayerOpacity': '底栏透明度',
  'lyricsSettings.display.miniPlayerPalette': '迷你底栏颜色调色盘',
  'lyricsSettings.display.preferUtatenKana': '优先 UtaTen 假名注音',
  'lyricsSettings.display.preferUtatenKanaDescription': '默认关闭；开启后日文歌词会尝试用 UtaTen 的ふりがな替代罗马音显示，匹配不到会自动回退。',
  'lyricsSettings.display.resetDesktopPosition': '重置桌面歌词位置',
  'lyricsSettings.display.resetDesktopPositionHint': '移回屏幕下方中央',
  'lyricsSettings.display.showRomanization': '显示罗马音',
  'lyricsSettings.display.showRomanizationDescription': '优先使用歌词源提供的罗马音；没有时会为日文歌词本地生成。',
  'lyricsSettings.display.showTranslation': '显示中文翻译',
  'lyricsSettings.display.showTranslationDescription': '优先显示歌词源提供的中文翻译；没有翻译时不显示额外文本。',
  'lyricsSettings.display.title': '歌词显示',
  'lyricsSettings.display.useMiniPlayerColor': '使用底栏颜色 {color}',
  'lyricsSettings.drawer.aria': '歌词设置',
  'lyricsSettings.drawer.close': '关闭歌词设置',
  'lyricsSettings.drawer.title': '歌词设置',
  'lyricsSettings.engine.autoMatch': '自动匹配',
  'lyricsSettings.engine.provider': '来源',
  'lyricsSettings.engine.threshold': '阈值',
  'lyricsSettings.engine.title': '歌词引擎',
  'lyricsSettings.font.applySystem': '应用系统字体',
  'lyricsSettings.font.chooseInstalled': '选择已安装字体',
  'lyricsSettings.font.custom': '自定义',
  'lyricsSettings.font.desktopOnly': '只影响桌面歌词',
  'lyricsSettings.font.importDesktop': '导入桌面歌词字体',
  'lyricsSettings.font.importFile': '导入字体文件',
  'lyricsSettings.font.lyricsOnly': '只影响歌词页和歌词行',
  'lyricsSettings.font.restoreDesktopDefault': '恢复桌面歌词默认字体',
  'lyricsSettings.font.restoreLyricsDefault': '恢复默认歌词字体',
  'lyricsSettings.font.system': '系统字体',
  'lyricsSettings.fontPicker.aria': '选择歌词字体',
  'lyricsSettings.fontPicker.chooseFile': '从文件选择字体',
  'lyricsSettings.fontPicker.close': '关闭歌词字体选择',
  'lyricsSettings.fontPicker.preview': '歌词字体预览 Aa 你好',
  'lyricsSettings.fontPicker.searchPlaceholder': '搜索已安装字体',
  'lyricsSettings.fontPicker.title': '选择歌词字体',
  'lyricsSettings.provider.cached': '缓存歌词',
  'lyricsSettings.provider.amllTtml': 'AMLL TTML',
  'lyricsSettings.provider.amllTtmlDescription': '逐词 TTML 歌词库，需要匹配网易云 ID，默认关闭',
  'lyricsSettings.provider.chineseCatalogDescription': '中文曲库补充',
  'lyricsSettings.provider.genius': 'Genius',
  'lyricsSettings.provider.kugou': '酷狗音乐',
  'lyricsSettings.provider.kuwo': '酷我音乐',
  'lyricsSettings.provider.local': '本地歌词',
  'lyricsSettings.provider.lrclib': 'LRCLIB',
  'lyricsSettings.provider.lrclibDescription': '开放歌词库',
  'lyricsSettings.provider.manual': '手动歌词',
  'lyricsSettings.provider.musixmatch': 'Musixmatch',
  'lyricsSettings.provider.netease': '网易云音乐',
  'lyricsSettings.provider.none': '未应用歌词',
  'lyricsSettings.provider.qqmusic': 'QQ 音乐',
  'lyricsSettings.preview.primary': '歌词预览',
  'lyricsSettings.preview.secondary': '辅助歌词行',
  'lyricsSettings.online.autoSearch': '自动匹配歌词',
  'lyricsSettings.online.autoSearchDescription': '本地歌词始终优先；在线结果达到阈值才会自动应用。',
  'lyricsSettings.online.autoSaveSidecar': '自动保存本地歌词文件',
  'lyricsSettings.online.autoSaveSidecarDescription': '默认关闭；在线或手动应用的歌词会保存为歌曲同名旁挂文件，不覆盖已有 .lrc / .ttml / .txt。',
  'lyricsSettings.online.deepSearch': '深度优先搜索',
  'lyricsSettings.online.deepSearchDescription': '开启后多个在线平台会并发搜索；任一结果达到自动应用阈值就立即停止其他源并返回。',
  'lyricsSettings.online.enable': '启用在线歌词匹配',
  'lyricsSettings.online.enableDescription': '仅发送标题、艺术家、专辑和时长用于匹配。',
  'lyricsSettings.online.sources': '歌词源',
  'lyricsSettings.online.sourcesDescription': '本地歌词会一直优先；未勾选的在线源不会参与自动匹配或重新匹配。',
  'lyricsSettings.online.title': '在线匹配',
  'lyricsSettings.status.applied': '已应用歌词',
  'lyricsSettings.status.applying': '应用中',
  'lyricsSettings.status.auto': '自动',
  'lyricsSettings.status.markedInstrumental': '已标记为纯音乐',
  'lyricsSettings.status.noCandidates': '未找到歌词候选',
  'lyricsSettings.status.noPlayingTrack': '没有正在播放的歌曲',
  'lyricsSettings.status.normal': '正常',
  'lyricsSettings.status.off': '关闭',
  'lyricsSettings.status.on': '开启',
  'lyricsSettings.status.rematchingCandidates': '正在重新匹配歌词...',
  'lyricsSettings.status.searchingCandidates': '正在搜索歌词候选...',
  'lyricsSettings.style.chooseLyricsColor': '选择歌词颜色',
  'lyricsSettings.style.contextOpacity': '上下文透明度',
  'lyricsSettings.style.fontSize': '歌词字号',
  'lyricsSettings.style.lineMaxChars': '每行字数',
  'lyricsSettings.style.lineMaxCharsValue': '{count}字',
  'lyricsSettings.style.lineSpacing': '歌词行距',
  'lyricsSettings.style.lyricsColor': '歌词颜色',
  'lyricsSettings.style.lyricsColorPalette': '歌词颜色调色盘',
  'lyricsSettings.style.lyricsFont': '歌词字体',
  'lyricsSettings.style.secondaryFontSize': '辅歌词字号',
  'lyricsSettings.style.showControls': '显示歌词样式设置',
  'lyricsSettings.style.showControlsDescription': '包含辅助字号、歌词字号、歌词行距、上下文透明度和歌词颜色。',
  'lyricsSettings.style.useColor': '使用颜色 {color}',
  'lyricsSettings.timing.defaultOffset': '新歌词默认延迟',
  'lyricsSettings.timing.globalOffset': '全局延迟',
  'lyricsSettings.timing.restoreDefaults': '恢复歌词默认值',
  'lyricsSettings.timing.restoreDefaultsHint': '匹配阈值 50% / 延迟 0ms',
  'lyricsSettings.timing.showPerTrackOffset': '显示本歌曲延迟校准',
  'lyricsSettings.timing.smartAlignment': '智能歌词校准',
  'lyricsSettings.timing.smartAlignmentDescription': '高置信时自动保存当前歌曲延迟；异常漂移只提示换源，可撤回。',
  'lyricsSettings.timing.timelineCorrection': '应用歌词时间轴校准',
  'lyricsSettings.timing.timelineCorrectionDescription': '全局延迟会影响所有歌曲；本歌曲延迟请在歌词页校准条里调整，会跟随当前歌曲单独记忆。',
  'lyricsSettings.timing.title': '匹配与延迟',
  'lyricsSettings.wordHighlight.clarity': '逐字高亮清晰度',
  'lyricsSettings.wordHighlight.clarityDescription': '默认“正常”；调高会让当前词未唱到的部分更完整，调低会更有逐字推进感。',
  'lyricsSettings.wordHighlight.description': '仅在歌词文件含真实逐字时间戳时启用；否则保持整行高亮。',
  'lyricsSettings.wordHighlight.title': '逐字歌词高亮',
  'route.mvSettings.description': 'MV 绑定与本地匹配设置。',
  'route.mvSettings.label': 'MV 设置',
  'mvSettings.action.chooseFile': '导入本地视频',
  'mvSettings.action.close': '关闭 MV 设置',
  'mvSettings.action.collapseNetwork': '折叠网络来源',
  'mvSettings.action.dragReorder': '拖拽调整优先级',
  'mvSettings.action.dragSource': '拖拽 {provider} 调整优先级',
  'mvSettings.action.expandNetwork': '展开网络来源',
  'mvSettings.action.findLocal': '查找本地',
  'mvSettings.action.openExternal': '在外部打开已选 MV',
  'mvSettings.action.refresh': '刷新',
  'mvSettings.action.removeSelected': '移除已选 MV',
  'mvSettings.action.searchNetwork': '搜索网络 MV',
  'mvSettings.aria.candidates': 'MV 候选列表',
  'mvSettings.aria.drawer': 'MV 设置',
  'mvSettings.aria.engineStatus': 'MV 引擎状态',
  'mvSettings.aria.maxQuality': '最高画质 {quality}',
  'mvSettings.aria.maxQualityOptions': '最高画质选项',
  'mvSettings.aria.networkSources': '网络来源优先级',
  'mvSettings.aria.selectedQuality': '已选 MV 画质 {quality}',
  'mvSettings.aria.selectedQualityOptions': '已选 MV 画质选项',
  'mvSettings.badge.credentialsMain': '凭据保留在主进程',
  'mvSettings.badge.proxyOnly': '仅代理访问',
  'mvSettings.binding.selectedMv': '已选 MV',
  'mvSettings.binding.title': 'MV来源',
  'mvSettings.candidate.external': '外部',
  'mvSettings.candidate.inApp': '应用内',
  'mvSettings.custom.apply': '应用自定义 MV',
  'mvSettings.custom.description': '粘贴 YouTube 或 Bilibili 视频链接作为当前 MV。',
  'mvSettings.custom.directDash': '直连流（DASH）',
  'mvSettings.custom.input': '自定义 MV 链接',
  'mvSettings.custom.placeholder': 'https://youtube.com/watch?v=... 或 BVxxxxxxxx',
  'mvSettings.custom.playing': '正在播放：{provider} - {sourceId}',
  'mvSettings.custom.title': '自定义 MV',
  'mvSettings.custom.videoTitle': '视频标题：{title}',
  'mvSettings.engine.mvTitle': 'MV标题',
  'mvSettings.engine.network': '网络',
  'mvSettings.engine.quality': '画质',
  'mvSettings.engine.selected': '已选',
  'mvSettings.engine.title': 'MV 引擎',
  'mvSettings.error.noActiveTrackBinding': '没有可用于 MV 绑定的当前曲库歌曲',
  'mvSettings.error.noActiveTrackMatching': '没有可用于 MV 匹配的当前曲库歌曲',
  'mvSettings.error.noActiveTrackNetworkSearch': '没有可用于网络 MV 搜索的当前曲库歌曲',
  'mvSettings.error.databaseUnavailable': 'MV 数据库暂时不可读，请先到曲库恢复里修复数据库。',
  'mvSettings.error.noLocalCandidates': '没有找到本地 MV 候选',
  'mvSettings.error.noNetworkCandidates': '没有找到网络 MV 候选',
  'mvSettings.general.enabled': '启用 MV',
  'mvSettings.immersive.blur': '毛玻璃模糊',
  'mvSettings.immersive.autoScale': '自动缩放',
  'mvSettings.immersive.autoScaleDescription': '根据 MV 宽高自动补偿缩放，尽量避免背景黑边。',
  'mvSettings.immersive.brightness': '背景亮度',
  'mvSettings.immersive.description': '开启后，歌词页使用当前 MV 作为背景。',
  'mvSettings.immersive.dragHint': '也可以在歌词页空白处拖动调整。',
  'mvSettings.immersive.hideLyrics': 'MV 界面隐藏歌词',
  'mvSettings.immersive.hideLyricsDescription': '开启后，切到 MV 界面时不显示歌词文本；默认关闭。',
  'mvSettings.immersive.lyricsReadability': '歌词可读性增强',
  'mvSettings.immersive.lyricsReadabilityDescription': '为沉浸式 MV 上的歌词增加描边和投影。',
  'mvSettings.immersive.overlay': '暗色遮罩',
  'mvSettings.immersive.overlayHint': '越低越接近原片，越高歌词越清晰。',
  'mvSettings.immersive.positionX': '横向位置',
  'mvSettings.immersive.positionY': '纵向位置',
  'mvSettings.immersive.reset': '重置沉浸式背景',
  'mvSettings.immersive.title': '沉浸式 MV 背景',
  'mvSettings.immersive.tuning': '沉浸式背景调节',
  'mvSettings.immersive.visualHint': '用于调节沉浸式背景观感。',
  'mvSettings.immersive.zoom': '背景缩放',
  'mvSettings.network.autoApply': '自动搜索网络MV',
  'mvSettings.network.autoApplyThreshold': '自动应用匹配度',
  'mvSettings.network.autoApplyThresholdDescription': '候选达到 {threshold} 以上才会自动应用。',
  'mvSettings.network.autoPreload': '是否预加载MV',
  'mvSettings.network.autoPreloadDescription': '开启后，只要播放歌曲就会尝试提前查找并准备当前歌曲的 MV。',
  'mvSettings.network.diagnosticsReport': 'MV 诊断报告',
  'mvSettings.network.diagnosticsReportDescription': '默认关闭；开启后，MV 页面无画面时显示可复制的本机诊断信息。',
  'mvSettings.network.maxQuality': '最高画质',
  'mvSettings.network.preferHighestViewCount': '按播放量匹配',
  'mvSettings.network.preferHighestViewCountDescription': '开启后自动搜索只用歌名和歌手，并优先选择播放量最高的可播放 MV。',
  'mvSettings.network.replayAudioOnChange': '切换MV后自动重播音乐',
  'mvSettings.network.replayAudioOnChangeDescription': '开启后，手动选择或绑定新的 MV 会重新播放当前歌曲，让新 MV 立即生效。',
  'mvSettings.network.restartAudioOnLoad': 'MV 跟随音乐进度',
  'mvSettings.network.restartAudioOnLoadDescription': '开启后，会持续校准 MV 视频时间，不会 seek 或重启音频；歌词同步偏移不会影响 MV。',
  'mvSettings.network.syncMode': '同步模式',
  'mvSettings.network.syncModeDescription': '轻微偏差用变速追平，大偏差才跳转视频。',
  'mvSettings.network.syncMode.stable': '稳定',
  'mvSettings.network.syncMode.balanced': '均衡',
  'mvSettings.network.syncMode.precise': '精准',
  'mvSettings.network.title': '网络来源',
  'mvSettings.offset.aria': 'MV 同步延迟',
  'mvSettings.offset.description': '正数让 MV 画面提前，负数让 MV 画面延后；只记住当前歌曲的 MV。',
  'mvSettings.offset.earlier': 'MV 提前 {value}',
  'mvSettings.offset.earlierShort': '提前 {value}',
  'mvSettings.offset.input': '偏移秒数',
  'mvSettings.offset.later': 'MV 延后 {value}',
  'mvSettings.offset.laterShort': '延后 {value}',
  'mvSettings.offset.replay': '重播',
  'mvSettings.offset.replayTitle': '重新播放当前歌曲，并按 MV 起播点同步视频',
  'mvSettings.offset.reset': '重置 MV 延迟',
  'mvSettings.offset.resetShort': '重置',
  'mvSettings.offset.slider': 'MV 同步延迟滑杆',
  'mvSettings.offset.startDescription': '输入视频里的起点秒数，最高 600 秒；这首歌会直接从那里对齐播放。',
  'mvSettings.offset.startInput': 'MV 起播秒数',
  'mvSettings.offset.startTitle': '从第几秒开始播放',
  'mvSettings.offset.step': '调节步长',
  'mvSettings.offset.title': 'MV 音画校准',
  'mvSettings.provider.local': '本地',
  'mvSettings.quality.max': '最高',
  'mvSettings.search.input': 'MV 搜索关键词',
  'mvSettings.search.placeholder': '输入 MV 搜索关键词',
  'mvSettings.search.useCurrentSong': '使用当前歌曲和歌手搜索',
  'mvSettings.status.auto': '自动',
  'mvSettings.status.noActiveTrack': '没有当前歌曲',
  'mvSettings.status.none': '无',
  'mvSettings.status.off': '关闭',
  'mvSettings.status.on': '开启',
  'mvSettings.title': 'MV 设置',
  'route.playlists.description': '用户歌单。',
  'route.playlists.label': '歌单',
  'playlistsPage.action.importFile': '导入 M3U/M3U8 歌单',
  'playlistsPage.action.newLocal': '新建本地歌单',
  'playlistsPage.daily.subtitle': '网易云账号推荐',
  'playlistsPage.daily.title': '每日推荐',
  'playlistsPage.empty.create': '新建歌单',
  'playlistsPage.empty.createFirst': '创建第一个本地歌单',
  'playlistsPage.empty.local': '还没有本地歌单。',
  'playlistsPage.error.desktopBridgeDailyRecommend': 'Desktop bridge unavailable. Open ECHO Next in Electron to refresh NetEase daily recommendations.',
  'playlistsPage.form.cancel': '取消新建',
  'playlistsPage.form.create': '创建',
  'playlistsPage.form.nameAria': '本地歌单名称',
  'playlistsPage.form.placeholder': '新建本地歌单',
  'playlistsPage.importStreaming.add': '添加歌单',
  'playlistsPage.importStreaming.adding': '添加中',
  'playlistsPage.importStreaming.placeholder': '粘贴网易云 / QQ 音乐 / 酷狗 / Spotify 歌单链接',
  'playlistsPage.importStreaming.title': '添加流媒体歌单',
  'playlistsPage.prompt.newLocalName': '新建本地歌单名称',
  'playlistsPage.status.createdLocal': '本地歌单已创建',
  'playlistsPage.status.importedStreamingPlaylist': '已添加歌单：{name}，共 {count} 首',
  'playlistsPage.status.importingStreamingPlaylist': '正在添加流媒体歌单...',
  'playlistsPage.status.loading': '正在读取歌单...',
  'playlistsPage.status.refreshedDaily': '已刷新每日推荐：{count} 首',
  'playlistsPage.status.refreshingDaily': '正在刷新网易云每日推荐...',
  'playlistsPage.view.aria': '播放列表视图',
  'playlistsPage.view.local': '本地歌单',
  'playlistsPage.view.streamingFavorites': '流媒体收藏',
  'route.plugins.description': '本地可编辑插件。',
  'route.plugins.label': '插件',
  'route.queue.description': '播放队列。',
  'route.queue.label': '队列',
  'route.remote.description': '远程来源。',
  'route.remote.label': '网盘 / 远程',
  'route.settings.description': '应用设置。',
  'route.settings.label': '设置',
  'route.songs.description': '本地曲库歌曲列表。',
  'route.songs.label': '歌曲',
  'songs.action.clearList': '清空列表',
  'songs.action.openRecovery': '去恢复助手',
  'songs.duplicatesOnly': '只看重复歌曲',
  'songs.error.albumNotFound': '未找到专辑：{album}',
  'songs.error.artistNotFound': '未找到艺术家：{artist}',
  'songs.error.desktopBridgeClear': 'Desktop bridge unavailable. Open ECHO Next in Electron to clear the library list.',
  'songs.error.desktopBridgeFileActions': 'Desktop bridge unavailable. Open ECHO Next in Electron to use file actions.',
  'songs.error.desktopBridgeLyricsCache': 'Desktop bridge unavailable. Open ECHO Next in Electron to clear lyrics cache.',
  'songs.error.desktopBridgeMaintain': 'Desktop bridge unavailable. Open ECHO Next in Electron to maintain the library.',
  'songs.error.desktopBridgePlay': 'Desktop bridge unavailable. Open ECHO Next in Electron to play local files.',
  'songs.error.desktopBridgePlaylists': 'Desktop bridge unavailable. Open ECHO Next in Electron to use playlists.',
  'songs.error.desktopBridgeRead': 'Desktop bridge unavailable. Open ECHO Next in Electron to read the library.',
  'songs.error.desktopBridgeVersions': 'Desktop bridge unavailable. Open ECHO Next in Electron to inspect duplicate versions.',
  'songs.importHint': '也可以直接把音乐文件或文件夹拖入窗口。支持 MP3, FLAC, WAV, ALAC, AAC, OPUS, OGG, APE, WV, DSF, DFF, CUE 等格式，更多格式会自动识别。',
  'songs.queueSource.local': '歌曲列表',
  'songs.queueSource.remote': '网盘歌曲',
  'songs.search.placeholder': '搜索曲目 / 艺人 / 专辑...',
  'songs.sort.album': '按专辑',
  'songs.sort.artist': '按艺术家',
  'songs.sort.artistAlbum': '按艺术家 / 专辑',
  'songs.sort.createdAsc': '创建时间（正序）',
  'songs.sort.createdDesc': '创建时间（倒序）',
  'songs.sort.default': '默认排序',
  'songs.sort.durationAsc': '音乐时间（短到长）',
  'songs.sort.durationDesc': '音乐时间（长到短）',
  'songs.sort.fileModifiedAsc': '文件修改时间（旧到新）',
  'songs.sort.fileModifiedDesc': '文件修改时间（新到旧）',
  'songs.sort.frequent': '根据常听歌曲排序',
  'songs.sort.menuAria': '歌曲排序',
  'songs.sort.qualityAsc': '歌曲质量/大小（小到大）',
  'songs.sort.qualityDesc': '歌曲质量/大小（大到小）',
  'songs.sort.random': '随机排序',
  'songs.sort.recent': '最近更新',
  'songs.sort.titleAsc': '歌曲名（A-Z）',
  'songs.sort.titleDesc': '歌曲名（Z-A）',
  'songs.trackList.aria': '歌曲列表',
  'songs.trackList.empty': '没有可显示的歌曲。导入音乐文件夹后，这里会显示曲库列表。',
  'route.streaming.description': '流媒体音乐源。',
  'route.streaming.label': '流媒体',
  'streaming.empty.notFoundAlbum': '没有找到匹配的专辑。',
  'streaming.empty.notFoundArtist': '没有找到匹配的歌手。',
  'streaming.empty.notFoundPlaylist': '没有找到匹配的歌单。',
  'streaming.empty.notFoundTrack': '没有找到匹配的流媒体歌曲。',
  'streaming.empty.searchHint': '输入关键词开始搜索。播放时才会解析真实地址，队列不会保存临时 URL。',
  'streaming.hero.currentProvider': '当前来源',
  'streaming.hero.description': '搜索在线曲库，播放前临时解析音频地址。',
  'streaming.hero.meterAria': '当前流媒体状态',
  'streaming.hero.preparingSearch': '准备搜索',
  'streaming.hero.title': '流媒体音乐',
  'streaming.provider.available': '可用',
  'streaming.provider.disabled': '未启用',
  'streaming.provider.loggedIn': '已登录 {name}',
  'streaming.provider.notLoggedIn': '未登录',
  'streaming.providers.aria': '流媒体平台',
  'streaming.quality.high': '高音质',
  'streaming.quality.highDescription': '320kbps 优先',
  'streaming.quality.hires': 'Hi-Res',
  'streaming.quality.hiresDescription': '平台可用时启用',
  'streaming.quality.label': '音质',
  'streaming.quality.lossless': '无损',
  'streaming.quality.losslessDescription': '优先 FLAC',
  'streaming.quality.max': 'Max',
  'streaming.quality.maxDescription': '默认最高音质',
  'streaming.quality.menuAria': '音质',
  'streaming.quality.standard': '标准',
  'streaming.quality.standardDescription': '兼容更好',
  'streaming.quality.switchFailed': '切换音质失败',
  'streaming.quality.switched': '已切换音质：{quality}',
  'streaming.result.count': '{count} 项结果',
  'streaming.result.searching': '正在搜索',
  'streaming.result.searchingEllipsis': '正在搜索...',
  'streaming.search.placeholder': '搜索歌曲、歌手、专辑',
  'streaming.tab.album': '专辑',
  'streaming.tab.artist': '歌手',
  'streaming.tab.playlist': '歌单',
  'streaming.tab.track': '单曲',
  'streaming.tabs.aria': '结果类型',
  'settings.about.audioHost.description': 'echo-audio-host.exe 当前用于本地迁移验收，正式发布后走 extraResources。',
  'settings.about.audioHost.title': '音频宿主',
  'settings.about.devMode.description': '当前正在使用 ECHO Next Phase 1：Library Core + Audio Host 验收。',
  'settings.about.devMode.title': '开发模式',
  'settings.about.nativeSqlite.description': 'better-sqlite3 会在 dev 前 rebuild 到 Electron ABI，避免扫描时模块版本不匹配。',
  'settings.about.nativeSqlite.title': '原生 SQLite',
  'settings.about.version.title': '版本号',
  'settings.about.version.description': '当前安装的 ECHO Next 版本。',
  'settings.about.updates.title': '自动更新',
  'settings.about.updates.description': '启动后自动检查 GitHub Release，下载完成后自动重启安装。',
  'settings.about.updates.currentVersion': '当前版本',
  'settings.about.updates.latestVersion': '最新版本',
  'settings.about.updates.status': '状态',
  'settings.about.updates.lastChecked': '上次检查',
  'settings.about.updates.autoCheck': '自动检查更新',
  'settings.about.updates.action.check': '检查更新',
  'settings.about.updates.action.checking': '检查中...',
  'settings.about.updates.action.afdian': '爱发电',
  'settings.about.updates.action.history': '查看历史更新日志',
  'settings.about.updates.action.qq': '加入 QQ 群聊',
  'settings.about.updates.action.discord': '加入 Discord',
  'settings.about.updates.progress.ready': '下载完成，准备安装',
  'settings.about.updates.progress.downloading': '正在下载更新',
  'settings.about.updates.progress.aria': 'OTA 更新下载进度 {percent}%',
  'settings.about.updates.releaseNotes': '更新日志',
  'settings.about.updates.releaseNotesPending': '更新日志稍后显示...',
  'settings.about.updates.releaseNotesEmpty': '更新日志会在 GitHub Release 返回 release notes 后显示。',
  'settings.about.updates.state.idle': '待检查',
  'settings.about.updates.state.checking': '正在检查',
  'settings.about.updates.state.available': '发现新版本',
  'settings.about.updates.state.downloading': '下载中',
  'settings.about.updates.state.downloaded': '下载完成，正在安装',
  'settings.about.updates.state.notAvailable': '已是最新',
  'settings.about.updates.state.error': '检查失败',
  'settings.about.updates.state.disabled': '已关闭',
  'settings.appearance.density.compact': '紧凑',
  'settings.appearance.density.description': '曲库列表采用更紧凑的桌面密度，不再使用过大的卡片行。',
  'settings.appearance.density.standard': '标准',
  'settings.appearance.density.title': '界面密度',
  'settings.appearance.artistAvatars.action.clear': '清除头像缓存',
  'settings.appearance.artistAvatars.action.queueing': '加入队列中...',
  'settings.appearance.artistAvatars.action.refreshMissing': '刷新缺失头像',
  'settings.appearance.artistAvatars.description': '在后台慢速获取真实歌手头像，并在艺术家墙复用本地缓存图片。',
  'settings.appearance.artistAvatars.fallback': '搜索不到时使用艺术家专辑封面',
  'settings.appearance.artistAvatars.message.cleared': '已清除 {removedRows} 条头像记录和 {deletedFiles} 个文件。',
  'settings.appearance.artistAvatars.message.desktopBridgeClear': '桌面桥不可用。请在 Electron 中打开 ECHO Next 以清除歌手头像。',
  'settings.appearance.artistAvatars.message.desktopBridgeRefresh': '桌面桥不可用。请在 Electron 中打开 ECHO Next 以刷新歌手头像。',
  'settings.appearance.artistAvatars.message.enableFirst': '请先开启自动获取歌手头像。',
  'settings.appearance.artistAvatars.message.queued': '已加入 {queued} 个歌手头像。跳过 {skipped} 个。',
  'settings.appearance.artistAvatars.title': '歌手头像',
  'settings.appearance.artistAvatars.toggle': '自动获取歌手头像',
  'settings.appearance.albumCoverShape.title': '专辑封面形状',
  'settings.appearance.albumCoverShape.description': '选择专辑封面显示为圆角或方角；该设置优先于主题预设。默认圆角。',
  'settings.appearance.albumCoverShape.rounded': '圆角',
  'settings.appearance.albumCoverShape.square': '方角',
  'settings.appearance.font.choose': '选择',
  'settings.appearance.font.chinese.description': '当主字体缺少中文字符时，优先使用这个中文字体补齐。',
  'settings.appearance.font.chinese.title': '中文字体',
  'settings.appearance.font.fallback.description': '界面字体的第三组备用，优先级最低，用于继续补齐缺失字符。',
  'settings.appearance.font.fallback.title': '备用字体',
  'settings.appearance.font.main.description': 'ECHO 默认使用内置 Monocraft 与站酷快乐体；也可以输入任意已安装字体名称。',
  'settings.appearance.font.main.title': '主字体',
  'settings.appearance.fontSize.description': '调整全局界面的基础字号。',
  'settings.appearance.fontSize.title': '基础字号',
  'settings.appearance.lineHeight.description': '调整界面文字的默认行距，让列表和说明文本更疏朗或更紧凑。',
  'settings.appearance.lineHeight.title': '界面行距',
  'settings.appearance.nowPlayingCoverColor.title': '播放界面封面取色',
  'settings.appearance.nowPlayingCoverColor.description': '开启后，正在播放页会在空闲时从小封面抽样生成轻量背景；低负载模式会自动跳过。默认关闭。',
  'settings.appearance.reset.action': '恢复默认',
  'settings.appearance.reset.description': '恢复 Monocraft、站酷快乐体、字号、行距、文字深浅与圆角封面。',
  'settings.appearance.reset.title': '外观默认值',
  'settings.appearance.sidebar.title': '左侧栏',
  'settings.appearance.sidebar.description': '调整左侧入口的顺序和显示状态，不会改动页面或播放链路。',
  'settings.appearance.sidebar.expand': '展开左侧栏布局',
  'settings.appearance.sidebar.collapse': '收起左侧栏布局',
  'settings.appearance.sidebar.mainGroup': '主导航',
  'settings.appearance.sidebar.utilityGroup': '底部入口',
  'settings.appearance.sidebar.reset': '恢复默认',
  'settings.appearance.sidebar.visible': '显示',
  'settings.appearance.sidebar.hidden': '隐藏',
  'settings.appearance.sidebar.fixed': '固定显示',
  'settings.appearance.sidebar.noItems': '这一组没有可调整的入口。',
  'settings.appearance.sidebar.summary.allVisible': '全部显示',
  'settings.appearance.sidebar.summary.hidden': '已隐藏 {count} 个入口',
  'settings.appearance.sidebar.count': '{count} 项',
  'settings.appearance.sidebar.moveUp': '上移',
  'settings.appearance.sidebar.moveDown': '下移',
  'settings.appearance.sidebar.moveUpAria': '上移 {label}',
  'settings.appearance.sidebar.moveDownAria': '下移 {label}',
  'settings.appearance.sidebar.hideAria': '隐藏 {label}',
  'settings.appearance.sidebar.showAria': '显示 {label}',
  'settings.appearance.textDepth.description': '调整界面文字颜色深浅；数值越低越浅。',
  'settings.appearance.textDepth.title': '文字颜色深浅',
  'settings.appearance.wallpaper.title': '自定义背景',
  'settings.appearance.wallpaper.description': '横屏与竖屏背景独立保存；竖屏窗口只会应用竖屏背景。支持图片和本地视频。',
  'settings.appearance.wallpaper.choose': '选择横屏背景',
  'settings.appearance.wallpaper.clear': '清除横屏背景',
  'settings.appearance.wallpaper.portraitChoose': '选择竖屏背景',
  'settings.appearance.wallpaper.portraitClear': '清除竖屏背景',
  'settings.appearance.wallpaper.landscapePath': '横屏',
  'settings.appearance.wallpaper.portraitPath': '竖屏',
  'settings.appearance.wallpaper.videoStatus': '视频壁纸 · 静音循环',
  'settings.appearance.wallpaper.videoPause.smart': '智能暂停',
  'settings.appearance.wallpaper.videoPause.minimized': '最小化暂停',
  'settings.appearance.wallpaper.videoPause.never': '始终播放',
  'settings.appearance.wallpaper.scale': '壁纸缩放',
  'settings.appearance.wallpaper.blur': '壁纸模糊度',
  'settings.appearance.wallpaper.brightness': '壁纸亮度',
  'settings.appearance.wallpaper.uiOpacity': 'UI 透明度',
  'settings.appearance.wallpaper.visualProtection': '可视化保护',
  'settings.appearance.wallpaper.unifiedOpacity': '统一透明度',
  'settings.appearance.theme.dark': '深色',
  'settings.appearance.theme.description': '选择浅色、深色，或跟随系统外观。',
  'settings.appearance.theme.followSystem': '跟随系统',
  'settings.appearance.theme.light': '浅色',
  'settings.appearance.themeSchedule.title': '定时切换深色模式',
  'settings.appearance.themeSchedule.description': '以用户系统时间为准，到点自动切到深色，再按设定时间切回浅色。',
  'settings.appearance.themeSchedule.toggle': '启用定时',
  'settings.appearance.themeSchedule.toggleAria': '启用定时切换深色模式',
  'settings.appearance.themeSchedule.darkAt': '切到深色',
  'settings.appearance.themeSchedule.lightAt': '切回浅色',
  'settings.appearance.themeSchedule.status.enabled': '已启用：{darkAt} 切到{mode}，{lightAt} 自动切回浅色。当前按本机时间使用{mode}。',
  'settings.appearance.themeSchedule.status.disabled': '关闭后仍使用上面的手动主题模式。',
  'settings.appearance.theme.title': '主题',
  'settings.appearance.themePreset.title': '主题预设',
  'settings.appearance.themePreset.description': '选择一套全局渐变色板；当前明暗模式仍会保留。',
  'settings.appearance.themePreset.classic': '经典 ECHO Next',
  'settings.appearance.themePreset.classic.description': '白灰基底、克制蓝紫强调，接近 Roon 的干净耐看。',
  'settings.appearance.themePreset.echoTwilight': '暮光桃雾',
  'settings.appearance.themePreset.echoTwilight.description': '老版 ECHO 的暖粉渐变感。',
  'settings.appearance.themePreset.sakuraMilk': '樱粉奶霜',
  'settings.appearance.themePreset.sakuraMilk.description': '奶白粉底配樱桃红强调。',
  'settings.appearance.themePreset.peachSoda': '蜜桃苏打',
  'settings.appearance.themePreset.peachSoda.description': '蜜桃橙和苏打青的轻快组合。',
  'settings.appearance.themePreset.mintCandy': '薄荷软糖',
  'settings.appearance.themePreset.mintCandy.description': '薄荷绿、奶油白和一点桃粉。',
  'settings.appearance.themePreset.berryDream': '蓝莓星糖',
  'settings.appearance.themePreset.berryDream.description': '莓紫云白，带一点梦幻粉光。',
  'settings.appearance.themePreset.matchaCream': '抹茶奶油',
  'settings.appearance.themePreset.matchaCream.description': '抹茶绿和奶油黄，更安静耐看。',
  'settings.appearance.themePreset.lemonMochi': '柠檬麻薯',
  'settings.appearance.themePreset.lemonMochi.description': '奶黄和天蓝，像软糯柠檬点心。',
  'settings.appearance.themePreset.cottonCloud': '棉花云朵',
  'settings.appearance.themePreset.cottonCloud.description': '云白蓝配柔粉，高亮但不刺眼。',
  'settings.appearance.themePreset.melonCream': '哈密瓜奶霜',
  'settings.appearance.themePreset.melonCream.description': '蜜瓜绿与奶油底，清甜可读。',
  'settings.appearance.themePreset.seaSaltJelly': '海盐果冻',
  'settings.appearance.themePreset.seaSaltJelly.description': '海盐青配蜜桃光，清透但压得住文字。',
  'settings.appearance.themePreset.caramelPudding': '焦糖布丁',
  'settings.appearance.themePreset.caramelPudding.description': '奶油焦糖配草莓光，甜但不发腻。',
  'settings.appearance.themePreset.neonCandy': '霓虹糖果',
  'settings.appearance.themePreset.neonCandy.description': '紫色霓虹、粉色高光和薄荷泡泡。',
  'settings.appearance.themePreset.nyanCat': 'Nyan Cat',
  'settings.appearance.themePreset.nyanCat.description': '慢速流动的可爱彩虹渐变，进度条会带着彩虹猫一起跑。',
  'settings.appearance.themePreset.childrenDoodle': '六一涂鸦',
  'settings.appearance.themePreset.childrenDoodle.description': '纸纹、蜡笔边框和乱涂贴纸，像儿童节手账一样热闹。',
  'settings.appearance.themePreset.wisteriaBubble': '紫藤泡泡',
  'settings.appearance.themePreset.wisteriaBubble.description': '紫藤花雾配薄荷泡泡，梦幻但清爽。',
  'settings.appearance.themePreset.strawberryCookie': '草莓饼干',
  'settings.appearance.themePreset.strawberryCookie.description': '奶油饼干底配草莓红和烘焙金。',
  'settings.appearance.themePreset.graphiteAurora': '石墨极光',
  'settings.appearance.themePreset.graphiteAurora.description': '石墨灰里带一点青绿极光，冷静但有层次。',
  'settings.appearance.themePreset.amberNoir': '琥珀夜色',
  'settings.appearance.themePreset.amberNoir.description': '黑金唱片厅感，适合暗色长听。',
  'settings.appearance.themePreset.oceanStudio': '海岸录音室',
  'settings.appearance.themePreset.oceanStudio.description': '冷蓝灰和海雾蓝，干净专业。',
  'settings.appearance.themePreset.rosewoodVinyl': '玫瑰木黑胶',
  'settings.appearance.themePreset.rosewoodVinyl.description': '木质暖红与黑胶暗调，更沉稳复古。',
  'settings.appearance.themePreset.darkSideMoon': 'The Dark Side of the Moon',
  'settings.appearance.themePreset.darkSideMoon.description': '致敬 Pink Floyd：黑月、白色棱镜与彩虹光谱。',
  'settings.appearance.themePreset.shibuyaNight': '涩谷夜色',
  'settings.appearance.themePreset.shibuyaNight.description': '东京霓虹、夜紫街口和青色招牌光。',
  'settings.appearance.themePreset.kyotoKurenai': '京都朱印',
  'settings.appearance.themePreset.kyotoKurenai.description': '鸟居朱红、和纸暖底和御守金色。',
  'settings.appearance.themePreset.ukiyoIndigo': '浮世靛蓝',
  'settings.appearance.themePreset.ukiyoIndigo.description': '浮世绘海浪的靛蓝、纸色和古金。',
  'settings.appearance.themePreset.fujiSnow': '富士初雪',
  'settings.appearance.themePreset.fujiSnow.description': '雪白、富士蓝与淡樱高光，清澈冷甜。',
  'settings.appearance.themePreset.matsuriLantern': '祭灯金鱼',
  'settings.appearance.themePreset.matsuriLantern.description': '夏祭灯笼红、夜市金光和温暖纸色。',
  'settings.appearance.themePreset.ginzaNoir': '银座黑曜',
  'settings.appearance.themePreset.ginzaNoir.description': '黑曜石、香槟金和橱窗蓝，成熟一点。',
  'settings.appearance.themePreset.frostJazz': '霜林爵士',
  'settings.appearance.themePreset.frostJazz.description': '冷蓝爵士底色，带一抹梅紫舞台光。',
  'settings.appearance.themePreset.FINAL': 'FINAL',
  'settings.appearance.themePreset.FINAL.description': '参考 final 官网的黑白产品摄影、声学工程与 8K SOUND 语言，克制、精密、偏监听。',
  'settings.appearance.themeCustom.title': '自定义当前主题',
  'settings.appearance.themeCustom.description': '先选一个主题，再微调颜色；每个主题都会记住自己的自定义。',
  'settings.appearance.themeCustom.action.autoFix': '自动修正文字',
  'settings.appearance.themeCustom.action.create': '新建我的主题',
  'settings.appearance.themeCustom.action.rename': '重命名',
  'settings.appearance.themeCustom.action.duplicate': '复制',
  'settings.appearance.themeCustom.action.delete': '删除',
  'settings.appearance.themeCustom.action.copyLightToDark': '复制浅色到深色',
  'settings.appearance.themeCustom.action.copyDarkToLight': '复制深色到浅色',
  'settings.appearance.themeCustom.action.export': '导出参数',
  'settings.appearance.themeCustom.action.import': '导入参数',
  'settings.appearance.themeCustom.action.reset': '重置当前自定义',
  'settings.appearance.themeCustom.action.save': '保存自定义',
  'settings.appearance.themeCustom.expand': '展开我的主题',
  'settings.appearance.themeCustom.collapse': '收起我的主题',
  'settings.appearance.themeCustom.advanced.show': '展开高级设置',
  'settings.appearance.themeCustom.advanced.hide': '收起高级设置',
  'settings.appearance.themeCustom.field.appBg': '底色',
  'settings.appearance.themeCustom.field.appBg2': '渐变中段',
  'settings.appearance.themeCustom.field.appBg3': '渐变尾色',
  'settings.appearance.themeCustom.field.panel': '玻璃色调',
  'settings.appearance.themeCustom.field.panelSoft': '柔面板',
  'settings.appearance.themeCustom.field.accent': '主强调色',
  'settings.appearance.themeCustom.field.accentStrong': '次强调色',
  'settings.appearance.themeCustom.field.secondary': '第三强调色',
  'settings.appearance.themeCustom.field.heading': '主文字',
  'settings.appearance.themeCustom.field.text': '正文文字',
  'settings.appearance.themeCustom.field.muted': '次要文字',
  'settings.appearance.themeCustom.field.border': '边界色',
  'settings.appearance.themeCustom.field.onAccent': '强调按钮文字',
  'settings.appearance.themeCustom.field.buttonText': '普通按钮文字',
  'settings.appearance.themeCustom.field.panelOpacity': '面板透明度',
  'settings.appearance.themeCustom.field.glass': '玻璃感',
  'settings.appearance.themeCustom.field.shadow': '阴影强度',
  'settings.appearance.themeCustom.field.titlebar': '标题栏',
  'settings.appearance.themeCustom.field.sidebar': '侧栏',
  'settings.appearance.themeCustom.field.player': '播放器',
  'settings.appearance.themeCustom.field.field': '输入框',
  'settings.appearance.themeCustom.field.row': '列表行',
  'settings.appearance.themeCustom.field.rowHover': '悬停行',
  'settings.appearance.themeCustom.field.rowActive': '选中行',
  'settings.appearance.themeCustom.field.chip': '芯片',
  'settings.appearance.themeCustom.field.focus': '焦点环',
  'settings.appearance.themeCustom.field.success': '成功色',
  'settings.appearance.themeCustom.field.warning': '警告色',
  'settings.appearance.themeCustom.field.danger': '危险色',
  'settings.appearance.themeCustom.field.cornerRadius': '圆角',
  'settings.appearance.themeCustom.field.panelBlur': '面板模糊',
  'settings.appearance.themeCustom.field.saturation': '饱和度',
  'settings.appearance.themeCustom.field.motionEnabled': '启用动效',
  'settings.appearance.themeCustom.field.motionSpeed': '动效速度',
  'settings.appearance.themeCustom.field.motionIntensity': '动效强度',
  'settings.appearance.themeCustom.field.appBg.description': '主窗口底色',
  'settings.appearance.themeCustom.field.appBg2.description': '背景渐变的柔光中段',
  'settings.appearance.themeCustom.field.appBg3.description': '背景渐变的末端停靠色',
  'settings.appearance.themeCustom.field.panel.description': '面板磨砂着色',
  'settings.appearance.themeCustom.field.panelSoft.description': '侧栏和弱层级面板',
  'settings.appearance.themeCustom.field.accent.description': '主要交互',
  'settings.appearance.themeCustom.field.accentStrong.description': '渐变与层次',
  'settings.appearance.themeCustom.field.secondary.description': '高光点缀',
  'settings.appearance.themeCustom.field.heading.description': '标题与主文案',
  'settings.appearance.themeCustom.field.text.description': '正文、歌手和设置文案',
  'settings.appearance.themeCustom.field.muted.description': '辅助说明',
  'settings.appearance.themeCustom.field.border.description': '卡片边框和分割线',
  'settings.appearance.themeCustom.field.onAccent.description': '强调按钮上的文字',
  'settings.appearance.themeCustom.field.buttonText.description': '普通按钮和芯片文字',
  'settings.appearance.themeCustom.field.panelOpacity.description': '面板露出背景的程度',
  'settings.appearance.themeCustom.field.glass.description': '背景模糊和玻璃层次',
  'settings.appearance.themeCustom.field.shadow.description': '卡片、弹窗和播放器投影',
  'settings.appearance.themeCustom.field.titlebar.description': '窗口顶部栏背景',
  'settings.appearance.themeCustom.field.sidebar.description': '左侧导航和弱层级区域',
  'settings.appearance.themeCustom.field.player.description': '底部播放器背景',
  'settings.appearance.themeCustom.field.field.description': '输入框和搜索框底色',
  'settings.appearance.themeCustom.field.row.description': '列表普通行背景',
  'settings.appearance.themeCustom.field.rowHover.description': '鼠标悬停行背景',
  'settings.appearance.themeCustom.field.rowActive.description': '当前选中行背景',
  'settings.appearance.themeCustom.field.chip.description': '筛选芯片和小按钮底色',
  'settings.appearance.themeCustom.field.focus.description': '键盘焦点和描边高亮',
  'settings.appearance.themeCustom.field.success.description': '成功状态提示',
  'settings.appearance.themeCustom.field.warning.description': '警告状态提示',
  'settings.appearance.themeCustom.field.danger.description': '危险操作提示',
  'settings.appearance.themeCustom.field.cornerRadius.description': '面板和按钮圆角大小',
  'settings.appearance.themeCustom.field.panelBlur.description': '玻璃面板模糊半径',
  'settings.appearance.themeCustom.field.saturation.description': '界面整体色彩浓度',
  'settings.appearance.themeCustom.field.motionEnabled.description': '只影响 CSS 过渡变量',
  'settings.appearance.themeCustom.field.motionSpeed.description': 'CSS 动效时长',
  'settings.appearance.themeCustom.field.motionIntensity.description': 'CSS 位移和强调强度',
  'settings.appearance.themeCustom.preview.title': '正在编辑',
  'settings.appearance.themeCustom.preview.description': '改动会先实时预览，保存后才写入设置。',
  'settings.appearance.themeCustom.myThemes.title': '我的主题',
  'settings.appearance.themeCustom.myThemes.description': '另存、切换、复制、导入导出安全主题参数。',
  'settings.appearance.themeCustom.myThemes.empty': '还没有自定义主题。',
  'settings.appearance.themeCustom.group.core': '常用颜色',
  'settings.appearance.themeCustom.group.core.description': '老 ECHO 式主色板，改这里最直观。',
  'settings.appearance.themeCustom.group.gradient': '背景渐变',
  'settings.appearance.themeCustom.group.gradient.description': '控制老 ECHO 那种窗口底色渐变氛围。',
  'settings.appearance.themeCustom.group.surface': '表面',
  'settings.appearance.themeCustom.group.surface.description': '标题栏、侧栏、播放器和列表层级。',
  'settings.appearance.themeCustom.group.state': '状态',
  'settings.appearance.themeCustom.group.state.description': '成功、警告、危险和焦点色。',
  'settings.appearance.themeCustom.group.motion': '动效',
  'settings.appearance.themeCustom.group.motion.description': '仅写入 CSS 变量，不增加运行时计时器。',
  'settings.appearance.themeCustom.group.advanced': '高级细节',
  'settings.appearance.themeCustom.group.advanced.description': '更细的文字、边界和按钮文字颜色。',
  'settings.appearance.themeCustom.message.created': '已新建我的主题。',
  'settings.appearance.themeCustom.message.copied': '已复制到目标色调，保存后生效。',
  'settings.appearance.themeCustom.message.exported': '已导出当前主题参数。',
  'settings.appearance.themeCustom.message.imported': '已导入主题参数并应用。',
  'settings.appearance.themeCustom.message.importFailed': '导入失败，请选择 ECHO 主题参数 JSON。',
  'settings.appearance.themeCustom.message.fixed': '已自动调整文字与按钮颜色。',
  'settings.appearance.themeCustom.message.invalidColor': '请输入 #RRGGBB 格式的安全颜色。',
  'settings.appearance.themeCustom.message.lowContrast': '当前文字对比度不足，可能影响阅读。可自动修正或手动调整文字颜色。',
  'settings.appearance.themeCustom.message.reset': '已重置当前主题的自定义。',
  'settings.appearance.themeCustom.message.saved': '已保存当前主题自定义。',
  'settings.danger.database.kicker': '曲库数据库安全',
  'settings.danger.database.title': '恢复助手',
  'settings.danger.database.badge.quarantined': '已隔离',
  'settings.danger.database.description.loading': '正在读取数据库健康状态、健康快照和最近维护记录。',
  'settings.danger.database.description.quarantined': '曲库因损坏嵌入标签或超大文本已被隔离。ECHO 会先打开恢复界面，音乐文件不会被删除。',
  'settings.danger.database.description.healthy': '当前数据库检查正常。这里会保留健康快照、坏库归档和最近维护记录。',
  'settings.danger.database.description.unrecoverable': '数据库无法从健康快照恢复。音乐文件不会被删除；请先导出诊断和查看保护目录，再确认归档坏库并重建空库。',
  'settings.danger.database.description.recoverable': '检测到数据库不可用时，先尝试恢复健康快照；恢复会先归档当前数据库，音乐文件不会被删除。',
  'settings.danger.database.health.ok': '健康',
  'settings.danger.database.health.corrupt': '疑似损坏',
  'settings.danger.database.health.unreadable': '无法读取',
  'settings.danger.database.health.idle': '待检查',
  'settings.danger.database.steps.quarantined.1': '当前曲库已被移出活动位置，ECHO 不会继续读取那批危险标签。',
  'settings.danger.database.steps.quarantined.2': '优先使用“修复隔离库副本”，它只处理归档副本，验证通过后才恢复。',
  'settings.danger.database.steps.quarantined.3': '如果修复失败，再选择恢复健康快照或归档并重建空曲库；音乐文件不会被删除。',
  'settings.danger.database.steps.unrecoverable.1': '先确认扫描没有运行；扫描中会拒绝恢复、重建和删除。',
  'settings.danger.database.steps.unrecoverable.2': '优先导出诊断并打开保护目录，保留坏库归档线索。',
  'settings.danger.database.steps.unrecoverable.3': '输入确认词“重建空库”后，归档坏库并重建空库，再重新添加曲库文件夹并扫描。',
  'settings.danger.database.steps.recoverable.1': '先确认扫描没有运行；扫描中会拒绝恢复、重建和删除。',
  'settings.danger.database.steps.recoverable.2': '优先点“恢复最近健康快照”，它只接受主进程枚举出的快照。',
  'settings.danger.database.steps.recoverable.3': '没有健康快照或恢复后仍损坏时，使用“归档坏库并重建空库”。',
  'settings.danger.database.action.check': '检查健康',
  'settings.danger.database.action.checking': '检查中...',
  'settings.danger.database.action.create': '创建健康快照',
  'settings.danger.database.action.creating': '创建中...',
  'settings.danger.database.action.restore': '恢复最近健康快照',
  'settings.danger.database.action.restoring': '恢复中...',
  'settings.danger.database.action.scrub': '修复隔离库副本',
  'settings.danger.database.action.scrubbing': '修复中...',
  'settings.danger.database.action.rebuild': '归档坏库并重建空库',
  'settings.danger.database.action.rebuilding': '重建中...',
  'settings.danger.database.action.discard': '归档问题曲目',
  'settings.danger.database.action.discarding': '归档中...',
  'settings.danger.database.action.relaunch': '重启到恢复模式',
  'settings.danger.database.action.relaunching': '重启中...',
  'settings.danger.database.action.open': '打开保护目录',
  'settings.danger.database.action.export': '导出诊断',
  'settings.danger.database.action.exporting': '导出中...',
  'settings.danger.database.meta.current': '当前数据库',
  'settings.danger.database.meta.snapshot': '最近健康快照',
  'settings.danger.database.meta.snapshotHint': '可手动创建',
  'settings.danger.database.meta.archive': '最近坏库归档',
  'settings.danger.database.meta.archiveHint': '恢复/重建前会自动归档',
  'settings.danger.database.meta.pending': '待加载',
  'settings.danger.database.meta.noSnapshot': '暂无健康快照',
  'settings.danger.database.meta.noArchive': '暂无坏库归档',
  'settings.danger.database.unavailable.scrub': '没有找到可修复的隔离库副本；请打开保护目录确认归档是否存在，或直接导出诊断。',
  'settings.danger.database.unavailable.restore': '暂无健康快照可恢复。可以先创建健康快照；如果当前库不可用，请导出诊断。',
  'settings.danger.database.confirmWord': '危险操作确认词',
  'settings.danger.database.confirmPlaceholder': '先输入按钮提示的确认词，再执行危险操作',
  'settings.danger.database.scanRunning': '曲库扫描正在运行，恢复、重建和删除会被拒绝。请等扫描结束后再操作。',
  'settings.danger.clearCache.description': '移除曲库索引、扫描记录和封面缓存，不会删除你的音乐文件或曲库文件夹。',
  'settings.danger.clearCache.title': '清空曲库缓存',
  'settings.danger.duplicates.title': '扫描重复歌曲并清理',
  'settings.danger.duplicates.description': '先扫描并列出重复组；清理时优先把低音质、低评分副本移入系统回收站，每组保留评分最高的一首。',
  'settings.danger.duplicates.meta.result': '扫描结果',
  'settings.danger.duplicates.meta.resultValue': '{groups} 组 / {tracks} 首待清理',
  'settings.danger.duplicates.meta.release': '预计释放',
  'settings.danger.duplicates.meta.scanTime': '扫描时间',
  'settings.danger.duplicates.meta.notScanned': '尚未扫描',
  'settings.danger.duplicates.action.scan': '扫描重复歌曲',
  'settings.danger.duplicates.action.scanning': '扫描中...',
  'settings.danger.duplicates.action.clean': '清理扫描结果',
  'settings.danger.duplicates.action.cleaning': '清理中...',
  'settings.danger.duplicates.progress.scan.title': '正在扫描重复歌曲',
  'settings.danger.duplicates.progress.scan.description': '分批处理，避免挤占播放',
  'settings.danger.duplicates.progress.scan.aria': '重复歌曲扫描中',
  'settings.danger.duplicates.progress.clean.title': '正在清理扫描结果',
  'settings.danger.duplicates.progress.clean.description': '移入回收站并更新曲库索引',
  'settings.danger.duplicates.progress.clean.aria': '重复歌曲清理中',
  'settings.devices.empty': 'echo-audio-host 暂未返回输出设备。',
  'settings.devices.title': '设备列表',
  'settings.general.artistInfoSources.description': '选择刷新艺人简介时使用的百科来源；百度百科更适合中文网络环境，Wikipedia 可作为国际艺人兜底。',
  'settings.general.artistInfoSources.title': '艺人信息源',
  'settings.general.artistStreamingAlbums.description': '开启后，艺人详情的专辑页会在本地专辑下方按需搜索并显示流媒体专辑；默认开启，可关闭以避免增加页面和网络压力。',
  'settings.general.artistStreamingAlbums.title': '流媒体专辑',
  'settings.general.backup.description': '导出或导入 ECHO Next 设置参数，用于迁移到新设备或恢复配置。',
  'settings.general.backup.export': '导出设置',
  'settings.general.backup.import': '导入设置',
  'settings.general.backup.title': '设置参数备份',
  'settings.general.dataBackup.title': '自动数据备份',
  'settings.general.dataBackup.description': '备份设置、曲库索引、播放记忆、账号本地状态、壁纸、封面缓存和元数据；备份前会校验曲库数据库，坏数据会被拒绝。',
  'settings.general.dataBackup.status.enabled': '自动备份已开启',
  'settings.general.dataBackup.status.disabled': '自动备份未开启',
  'settings.general.dataBackup.hint.directoryReady': '目录已设置，可手动备份或开启定期备份',
  'settings.general.dataBackup.hint.chooseDirectory': '请先选择备份目录',
  'settings.general.dataBackup.frequency.aria': '自动备份周期',
  'settings.general.dataBackup.frequency.days': '{days} 天',
  'settings.general.dataBackup.frequency.monthly': '每月',
  'settings.general.dataBackup.meta.directory': '目录',
  'settings.general.dataBackup.meta.lastBackup': '上次备份',
  'settings.general.dataBackup.meta.nextRun': '下次执行',
  'settings.general.dataBackup.meta.notSet': '未设置',
  'settings.general.dataBackup.meta.noneYet': '暂无自动备份',
  'settings.general.dataBackup.meta.nextRunPending': '选择目录并开启后生效',
  'settings.general.dataBackup.meta.atPath': '{time} · {path}',
  'settings.general.dataBackup.progress.preparing': '准备中',
  'settings.general.dataBackup.progress.snapshot': '创建快照',
  'settings.general.dataBackup.progress.scanning': '扫描数据',
  'settings.general.dataBackup.progress.writing': '写入备份',
  'settings.general.dataBackup.progress.finalizing': '收尾中',
  'settings.general.dataBackup.progress.completed': '已完成',
  'settings.general.dataBackup.progress.failed': '失败',
  'settings.general.dataBackup.progress.measuring': '统计中',
  'settings.general.dataBackup.progress.waiting': '等待写入',
  'settings.general.dataBackup.action.chooseDirectory': '选择目录',
  'settings.general.dataBackup.action.choosingDirectory': '选择中...',
  'settings.general.dataBackup.action.backupNow': '立即备份',
  'settings.general.dataBackup.action.backingUp': '备份中...',
  'settings.general.dataBackup.action.importBackup': '导入备份',
  'settings.general.dataBackup.action.importingBackup': '导入中...',
  'settings.general.dataBackup.action.openDirectory': '打开目录',
  'settings.general.dataPackage.title': '一键导出 / 迁移 ECHO 数据包',
  'settings.general.dataPackage.description': '导出设置、曲库索引、歌单快照、封面缓存路径和账号状态说明。不会复制音乐文件，也不会导出登录密钥。',
  'settings.general.dataPackage.action.export': '导出 ECHO 数据包',
  'settings.general.dataPackage.action.exporting': '打包中...',
  'settings.general.dataPackage.action.recovery': '恢复入口',
  'settings.general.dataPackage.note': '恢复前请先在危险区创建健康快照；迁移包里的 RESTORE.md 会说明每个文件的用途。',
  'settings.general.closeToTray': '关闭时隐藏到托盘',
  'settings.general.sidebarAutoHide.title': '隐藏侧栏',
  'settings.general.sidebarAutoHide.description': '开启后左侧栏会收进屏幕边缘；鼠标移到左边缘时自动抽出。默认关闭。',
  'settings.general.fastStartup.description': '开启后，启动时只做轻量只读曲库验证；完整数据保护快照会在窗口打开后后台完成。默认关闭。',
  'settings.general.fastStartup.title': '快速启动',
  'settings.general.firstRunWizard.description': '打开后会重新显示第一次启动时的向导，可选择标准输出（系统音频）、WASAPI、Exclusive 或 ASIO；完成或跳过后会自动关闭这个开关。',
  'settings.general.firstRunWizard.title': '首次启动指引',
  'settings.general.language.description': '选择菜单、应用内设置与系统对话框的显示语言。',
  'settings.general.language.title': '显示语言',
  'settings.general.playerWaveformProgress.description': '开启后，底部播放栏会用轻量波形样式显示进度；默认关闭，不解码音频也不增加后台分析。',
  'settings.general.playerWaveformProgress.title': '波形进度条',
  'settings.general.homeWaveformVisualizer.description': '控制主页“今日回声”的实时波形图。关闭后不渲染波形，也会跳过主页波形用的频谱分析。',
  'settings.general.homeWaveformVisualizer.title': '主页波形图',
  'settings.general.homeRandomHeroTitle.description': '开启后，首页标题会从随机文案池里抽取，也会混入一点网络梗。关闭后使用固定标题。',
  'settings.general.homeRandomHeroTitle.title': '首页随机标题',
  'settings.general.rememberWindowSize.description': '开启后会记住你上次拖拽后的窗口宽高，下次启动自动恢复。',
  'settings.general.rememberWindowSize.title': '记住窗口尺寸',
  'settings.general.searchTraditionalVariants.description': '开启后，输入繁体可以搜到简体结果，输入简体也可以搜到繁体结果。',
  'settings.general.searchTraditionalVariants.title': '简繁互搜',
  'settings.header.searchPlaceholder': '搜索设置...',
  'settings.integrations.discord.action.refresh': '刷新状态',
  'settings.integrations.discord.description': '将当前播放状态同步到 Discord Rich Presence，可显示歌曲、艺术家、进度和播放状态。',
  'settings.integrations.discord.title': 'Discord 状态',
  'settings.integrations.smtc.description': '把当前播放信息、封面、进度和媒体键动作发布到 Windows 音量浮层与锁屏媒体控件。',
  'settings.integrations.smtc.action.restart': '重启 SMTC',
  'settings.integrations.smtc.action.restarting': '重启中...',
  'settings.integrations.taskbarPlayback.description': '在 Windows 任务栏图标上显示播放进度，并在悬停缩略图里提供上一首、播放暂停和下一首按钮。',
  'settings.integrations.taskbarPlayback.title': '任务栏音乐控制',
  'settings.integrations.smtc.title': 'Windows 媒体控件',
  'settings.integrations.lastfm.action.completeAuth': '完成授权',
  'settings.integrations.lastfm.action.connect': '连接 Last.fm',
  'settings.integrations.lastfm.action.disconnect': '断开连接',
  'settings.integrations.lastfm.action.refresh': '刷新状态',
  'settings.integrations.lastfm.activeProgress': '{artist} - {title} · {played}/{threshold} 秒',
  'settings.integrations.lastfm.activeTrack': '当前曲目',
  'settings.integrations.lastfm.connection.description': '推荐使用浏览器授权。在 Last.fm 点 Allow 后，回到 ECHO Next 完成授权。',
  'settings.integrations.lastfm.connection.title': 'Last.fm 连接',
  'settings.integrations.lastfm.description': '在主进程记录本地播放，不发送文件路径、歌词或封面。',
  'settings.integrations.lastfm.lastNowPlaying': '上次 Now Playing',
  'settings.integrations.lastfm.lastScrobble': '上次 Scrobble',
  'settings.integrations.lastfm.never': '尚未发送',
  'settings.integrations.lastfm.noActiveTrack': '无活跃曲目',
  'settings.integrations.lastfm.nowPlaying.description': '开始播放时发送一次当前曲目信息。',
  'settings.integrations.lastfm.nowPlaying.title': 'Last.fm Now Playing',
  'settings.integrations.lastfm.scrobbling.description': '曲目达到 Last.fm 记录阈值后提交播放记录。',
  'settings.integrations.lastfm.scrobbling.title': 'Last.fm Scrobbling',
  'settings.integrations.lastfm.status.connected': '已连接 {username}',
  'settings.integrations.lastfm.status.error': '错误：{error}',
  'settings.integrations.lastfm.status.notConnected': '未连接',
  'settings.integrations.lastfm.status.pending': '等待完成授权',
  'settings.integrations.lastfm.statusLabel': '状态',
  'settings.integrations.lastfm.title': 'Last.fm',
  'settings.integrations.mobile.description': '未来外部设备能力会走受控 IPC，不让 Renderer 直连系统资源。',
  'settings.integrations.mobile.title': '手机遥控',
  'settings.integrations.accounts.cookieFallback': '登录账号后会自动保存 Cookie；手动粘贴 Cookie 作为备用方式。',
  'settings.integrations.accounts.cookiePlaceholder': '粘贴 Cookie 后保存',
  'settings.integrations.accounts.description.default': '歌词、元数据和下载接入预留。',
  'settings.integrations.accounts.description.bilibili': '用于 MV 解析和高清画质。',
  'settings.integrations.accounts.loginAndSync': '登录并同步',
  'settings.integrations.accounts.clickToLogin': '未登录，点此登录',
  'settings.integrations.accounts.logout': '退出',
  'settings.integrations.accounts.logoutBusy': '退出中...',
  'settings.integrations.accounts.manualSave': '手动保存',
  'settings.integrations.accounts.manualSaveBusy': '保存中...',
  'settings.integrations.accounts.check': '检查',
  'settings.integrations.accounts.checkBusy': '检查中...',
  'settings.integrations.accounts.loginBusy': '等待登录...',
  'settings.integrations.accounts.loginMeta': '登录 {loginAt} · 检查 {checkedAt}',
  'settings.integrations.accounts.loginStatus': '登录状态',
  'settings.integrations.accounts.soundcloudNote': 'SoundCloud 流播放使用这里保存的登录 Cookie，不需要 Artist Pro 或开发者 API。',
  'settings.integrations.accounts.osuNote': 'osu! 谱面下载会优先使用这里保存的登录 Cookie；官方失败时会自动尝试 Sayobot、Catboy 和 NeriNyan 镜像。',
  'settings.integrations.accounts.youtube.browser': '浏览器',
  'settings.integrations.accounts.youtube.browserNone': '不使用',
  'settings.integrations.accounts.youtube.description': '沿用系统浏览器登录逻辑，供后续解析/下载使用。',
  'settings.integrations.accounts.youtube.savedStatus': '选择浏览器后会保存系统浏览器登录状态。',
  'settings.integrations.accounts.spotify.description': '官方播放器接入，需要 Premium；请先在上方填写自己的 Spotify Client ID，并在 Spotify Dashboard 注册回调地址。',
  'settings.integrations.accounts.spotify.login': '登录 Spotify',
  'settings.integrations.accounts.spotify.loginBusy': '等待授权...',
  'settings.integrations.accounts.spotify.savedStatus': '使用 OAuth PKCE 授权，不保存 Client Secret；下载功能不适用于 Spotify。',
  'settings.integrations.accountPanel.title': '账号登录',
  'settings.integrations.accountPanel.description': '保存平台登录状态，供后续歌词、元数据、MV、下载和流媒体接入使用。Cookie 在登录账号后自动保存。',
  'settings.integrations.accountPanel.refreshAll': '刷新全部',
  'settings.integrations.accountStartupRefresh.title': '启动时刷新账号登录状态',
  'settings.integrations.accountStartupRefresh.description': '仅检查以前登录过的账号，从未登录过的平台会保持静默。',
  'settings.integrations.accountExpiryNotices.title': '关闭账号失效通知',
  'settings.integrations.accountExpiryNotices.description': '开启后，账号失效时不再弹出左上角提醒；账号状态仍可在这里查看。',
  'settings.integrations.credentialPanel.title': '开发者 / API 配置',
  'settings.integrations.credentialPanel.description': 'Spotify、TIDAL、Discogs、在线歌手和 Last.fm；用不到可以保持收起。',
  'settings.integrations.credentialPanel.expand': '展开 API 配置',
  'settings.integrations.credentialPanel.collapse': '收起 API 配置',
  'settings.integrations.smtcLyrics.title': 'SMTC 歌词显示',
  'settings.integrations.smtcLyrics.description': '允许把当前歌词行附加到 Windows 媒体信息里；默认关闭，避免污染歌手字段。',
  'settings.integrations.spotifyAutoLaunchOfficialPlayer.title': 'Spotify 自动启动官方播放器',
  'settings.integrations.spotifyAutoLaunchOfficialPlayer.description': '播放 Spotify 时，如果 ECHO 内置 SDK 因 DRM 不可用，会自动打开 Spotify 桌面端或网页版并接管 Connect 设备。',
  'settings.integrations.networkProxy.title': '网络代理',
  'settings.integrations.networkProxy.description': '给登录页、网络封面、歌词、MV 搜索和元数据补全使用。媒体播放流默认不走代理，避免影响缓冲和 Range 请求。',
  'settings.integrations.networkProxy.mode': '模式',
  'settings.integrations.networkProxy.modeAria': '网络代理模式',
  'settings.integrations.networkProxy.mode.off': '关闭',
  'settings.integrations.networkProxy.mode.system': '系统代理',
  'settings.integrations.networkProxy.mode.manual': '手动代理',
  'settings.integrations.networkProxy.manualUrl': '手动代理地址',
  'settings.integrations.networkProxy.manualPlaceholder': 'http://127.0.0.1:7890 或 socks5://127.0.0.1:7890',
  'settings.integrations.networkProxy.pacUrl': 'PAC 地址',
  'settings.integrations.networkProxy.bypass': '绕过地址',
  'settings.integrations.networkProxy.save': '保存并应用',
  'settings.integrations.networkProxy.saveBusy': '保存中...',
  'settings.integrations.networkProxy.test': '测试连接',
  'settings.integrations.networkProxy.testBusy': '测试中...',
  'settings.integrations.networkProxy.note': '第一版只默认代理普通联网能力；远程曲库和播放字节流保持直连，避免影响正在播放的稳定性。',
  'settings.library.network.description': '手动弱补全；本地内嵌元数据始终优先。',
  'settings.library.network.title': '网络元数据补全',
  'settings.library.networkSources.description': '选择手动修复和缺失扫描使用的补全源。',
  'settings.library.networkSources.title': '网络补全来源',
  'settings.library.networkPanel.applyMissingOnly': '仅补缺失项',
  'settings.library.networkPanel.applySelected': '应用所选候选',
  'settings.library.networkPanel.appliedCount': '已自动补全数量',
  'settings.library.networkPanel.artistField': '歌手',
  'settings.library.networkPanel.artistSource': '歌手来源',
  'settings.library.networkPanel.candidates': '候选',
  'settings.library.networkPanel.cover': '封面',
  'settings.library.networkPanel.embeddedCover': '内嵌封面',
  'settings.library.networkPanel.embeddedMetadata': '内嵌元数据',
  'settings.library.networkPanel.kicker': '手动修复',
  'settings.library.networkPanel.localCover': '本地',
  'settings.library.networkPanel.missingCover': '缺失/默认',
  'settings.library.networkPanel.noCandidates': '暂无网络候选。',
  'settings.library.networkPanel.providerErrors': '来源错误',
  'settings.library.networkPanel.reject': '拒绝',
  'settings.library.networkPanel.repairMissing': '补全当前歌曲',
  'settings.library.networkPanel.repairThisTrack': '补全此曲',
  'settings.library.networkPanel.scanComplete': '扫描完成',
  'settings.library.networkPanel.scanMissing': '扫描缺失信息',
  'settings.library.networkPanel.scanDone': '已扫描缺失曲目',
  'settings.library.networkPanel.scanPreparing': '准备扫描',
  'settings.library.networkPanel.scanProgress': '缺失元数据扫描进度',
  'settings.library.networkPanel.scanRunning': '正在扫描网络来源',
  'settings.library.networkPanel.showCandidates': '显示候选',
  'settings.library.networkPanel.title': '缺失元数据修复',
  'settings.library.networkPanel.titleField': '标题',
  'settings.library.networkPanel.trackId': '曲目 ID',
  'settings.library.networkPanel.trackNotFound': '找不到该曲目。请先播放一首歌，或输入曲目 ID。',
  'settings.library.networkPanel.unknownArtist': '未知歌手',
  'settings.library.networkPanel.untitled': '未命名',
  'settings.eq.action.addFilter': '新增滤波器',
  'settings.eq.action.autoPreamp': '自动 {value}',
  'settings.eq.action.bypass': '旁路',
  'settings.eq.action.delete': '删除',
  'settings.eq.action.deleteFilter': '移除滤波器',
  'settings.eq.action.duplicatePreset': '复制当前',
  'settings.eq.action.exportApoGraphicEqPreset': '导出 GraphicEQ',
  'settings.eq.action.exportApoPreset': '导出 APO',
  'settings.eq.action.freqDown': '频率 -',
  'settings.eq.action.freqFineDown': '细 -',
  'settings.eq.action.freqFineUp': '细 +',
  'settings.eq.action.freqUp': '频率 +',
  'settings.eq.action.holdBypass': '按住旁路 EQ',
  'settings.eq.action.holdOriginal': '按住听原声',
  'settings.eq.action.hideAdvanced': '隐藏 PEQ 控制台',
  'settings.eq.action.importPreset': '导入预设 / APO',
  'settings.eq.action.pasteApoPreset': '粘贴 APO',
  'settings.eq.action.applyA': '应用 A',
  'settings.eq.action.applyB': '应用 B',
  'settings.eq.action.applySafePreamp': '应用安全前级',
  'settings.eq.action.applyProfile': '应用配置档',
  'settings.eq.action.bindProfile': '绑定当前输出',
  'settings.eq.action.deleteProfile': '删除配置档',
  'settings.eq.action.overwrite': '覆盖当前',
  'settings.eq.action.redo': '重做',
  'settings.eq.action.resetBand': '重置 {frequency}',
  'settings.eq.action.resetAllGains': '重置全部增益',
  'settings.eq.action.resetChannelBalance': '重置声道平衡',
  'settings.eq.action.resetDelaysOnly': '重置延迟',
  'settings.eq.action.resetEq': '重置 EQ',
  'settings.eq.action.resetFrequencies': '恢复标准频点',
  'settings.eq.action.resetMonitorTools': '重置监听工具',
  'settings.eq.action.resetSelected': '重置选中',
  'settings.eq.action.resetTrimsOnly': '只重置校正',
  'settings.eq.action.revertUserPreset': '还原用户预设',
  'settings.eq.action.save': '保存',
  'settings.eq.action.saveAs': '另存为',
  'settings.eq.action.saveProfile': '保存配置档',
  'settings.eq.action.showAdvanced': 'PEQ 控制台',
  'settings.eq.action.storeA': '存入 A',
  'settings.eq.action.storeB': '存入 B',
  'settings.eq.action.toggleBypassOff': '关闭旁路',
  'settings.eq.action.toggleBypassOn': '切换旁路',
  'settings.eq.action.undo': '撤销',
  'settings.eq.action.unlockFrequency': '解锁频率',
  'settings.eq.ab.emptySlot': '空槽',
  'settings.eq.ab.loudnessMatched': '响度匹配',
  'settings.eq.ab.summary': '{preset} / peak {peak} / out {output} / preamp {preamp}',
  'settings.eq.ab.title': 'A/B 对比',
  'settings.eq.autoGain.adjustment': 'Auto {value}',
  'settings.eq.autoGain.status': '状态',
  'settings.eq.autoGain.status.clipping': 'Clipping',
  'settings.eq.autoGain.status.holding': 'Holding',
  'settings.eq.autoGain.status.idle': 'Idle',
  'settings.eq.autoGain.status.recovering': 'Recovering',
  'settings.eq.autoGain.status.reducing': 'Reducing',
  'settings.eq.autoGain.toggle': 'Auto Gain',
  'settings.eq.room.active': 'Active',
  'settings.eq.room.channelMode': '声道',
  'settings.eq.room.clear': '清除',
  'settings.eq.room.disable': '禁用 FIR',
  'settings.eq.room.empty': '未加载',
  'settings.eq.room.enable': '启用 FIR',
  'settings.eq.room.error': '错误',
  'settings.eq.room.error.invalidImpulse': 'IR 无效',
  'settings.eq.room.error.invalidWav': 'WAV 无效',
  'settings.eq.room.error.missingFile': 'IR 文件缺失',
  'settings.eq.room.error.missingIr': '未加载 IR',
  'settings.eq.room.error.tooLong': 'IR 过长',
  'settings.eq.room.import': '导入 IR',
  'settings.eq.room.ir': 'IR',
  'settings.eq.room.loaded': 'Loaded',
  'settings.eq.room.sampleRate': '采样率',
  'settings.eq.room.short': 'FIR',
  'settings.eq.room.tapCount': 'Taps',
  'settings.eq.room.title': '房间校正',
  'settings.eq.room.trim': 'Trim',
  'settings.eq.analyzer.overlayAria': 'EQ 实时频谱叠加',
  'settings.eq.analyzer.input': 'Input',
  'settings.eq.analyzer.mode': '频谱模式',
  'settings.eq.analyzer.postEq': 'Post EQ',
  'settings.eq.analyzer.status': '状态',
  'settings.eq.analyzer.status.live': 'Live',
  'settings.eq.analyzer.status.noSignal': 'No signal',
  'settings.eq.analyzer.status.off': 'Off',
  'settings.eq.analyzer.status.priming': 'Priming',
  'settings.eq.analyzer.toggle': '频谱',
  'settings.eq.band.fallback': '频段',
  'settings.eq.band.frequency': '频率',
  'settings.eq.band.frequencyStepper': '频率步进',
  'settings.eq.band.frequencySnapped': '吸附到标准频点',
  'settings.eq.band.frequencyUnlocked': '自由频率',
  'settings.eq.band.gain': '增益',
  'settings.eq.band.gainFixed': '此类型不使用增益',
  'settings.eq.band.gainStepper': '增益步进',
  'settings.eq.band.qPresets': 'Q 快捷值',
  'settings.eq.band.qPresetWide': 'Wide',
  'settings.eq.band.qPresetNormal': 'Normal',
  'settings.eq.band.qPresetNarrow': 'Narrow',
  'settings.eq.band.bypassed': '旁路',
  'settings.eq.band.console': '选中频段控制台',
  'settings.eq.band.enabled': '启用此段',
  'settings.eq.band.enabledShort': '启用',
  'settings.eq.band.filters': '滤波器',
  'settings.eq.band.filterStack': 'APO 滤波器链',
  'settings.eq.band.filterType': '类型',
  'settings.eq.band.inspector': '选中频段',
  'settings.eq.band.matrix': 'PEQ 频段矩阵',
  'settings.eq.band.modeFree': '自由频率',
  'settings.eq.band.modeStandard': '标准频点',
  'settings.eq.band.q': 'Q',
  'settings.eq.band.readoutsAria': '31 段 EQ 可拖动频段读数',
  'settings.eq.bitPerfect.channelDisabled': 'DSP 已启用：bit-perfect 已关闭。',
  'settings.eq.bitPerfect.disabled': 'DSP 已启用：bit-perfect 已关闭{reason}。',
  'settings.eq.bitPerfect.readyPath': '可保留 bit-perfect 路径。',
  'settings.eq.bitPerfect.sourceBoth': 'EQ + 声道平衡',
  'settings.eq.bitPerfect.sourceChannel': '声道平衡',
  'settings.eq.bitPerfect.sourceEq': 'EQ',
  'settings.eq.bitPerfect.sourceRoom': '房间校正',
  'settings.eq.channel.active': '启用',
  'settings.eq.channel.balance': '平衡',
  'settings.eq.channel.bypassed': '旁路',
  'settings.eq.channel.calibrationMode': '校准模式',
  'settings.eq.channel.center': '居中',
  'settings.eq.channel.constantPower': '恒定功率',
  'settings.eq.channel.description': 'Balance 用于左右偏移；L/R Gain 校正响度；L/R Delay 校正到达时间；Mono Sum 和 Invert 用于监听检查。',
  'settings.eq.channel.dsp': 'DSP',
  'settings.eq.channel.effectiveLeft': '左有效增益',
  'settings.eq.channel.effectiveRight': '右有效增益',
  'settings.eq.channel.group.balance': 'Balance',
  'settings.eq.channel.group.gainTrim': 'Gain Trim',
  'settings.eq.channel.group.monitorTools': '监听工具',
  'settings.eq.channel.group.phaseTools': '相位工具',
  'settings.eq.channel.group.timing': 'Timing',
  'settings.eq.channel.invertLeft': '左声道反相',
  'settings.eq.channel.invertRight': '右声道反相',
  'settings.eq.channel.leftDelay': '左延迟',
  'settings.eq.channel.leftGain': '左增益',
  'settings.eq.channel.leftTotal': '左总增益',
  'settings.eq.channel.mono.left': '左',
  'settings.eq.channel.mono.off': '关闭',
  'settings.eq.channel.mono.right': '右',
  'settings.eq.channel.mono.sum': '合并',
  'settings.eq.channel.monoMode': '单声道模式',
  'settings.eq.channel.quick.leftSolo': '左声道 Solo',
  'settings.eq.channel.quick.monoCheck': '单声道检查',
  'settings.eq.channel.quick.phaseCheck': '相位检查',
  'settings.eq.channel.quick.rightSolo': '右声道 Solo',
  'settings.eq.channel.quick.swapCheck': '交换检查',
  'settings.eq.channel.quickTools': '快速监听工具',
  'settings.eq.channel.rightDelay': '右延迟',
  'settings.eq.channel.rightGain': '右增益',
  'settings.eq.channel.rightTotal': '右总增益',
  'settings.eq.channel.swap': '交换 L/R',
  'settings.eq.channel.title': '声道平衡',
  'settings.eq.channel.wizard.apply': '应用测量校准',
  'settings.eq.channel.wizard.clear': '清空测量',
  'settings.eq.channel.wizard.empty': '等待测量',
  'settings.eq.channel.wizard.imageLeft': '声像偏左',
  'settings.eq.channel.wizard.imageRight': '声像偏右',
  'settings.eq.channel.wizard.leftDistance': '左距离',
  'settings.eq.channel.wizard.leftLouder': '左边更响',
  'settings.eq.channel.wizard.leftSpl': '左 SPL',
  'settings.eq.channel.wizard.monitor': '空间校准监听',
  'settings.eq.channel.wizard.nudge': '空间校准微调',
  'settings.eq.channel.wizard.previewCenter': '中心检查',
  'settings.eq.channel.wizard.previewLeft': '左检查',
  'settings.eq.channel.wizard.previewRight': '右检查',
  'settings.eq.channel.wizard.ready': '可应用',
  'settings.eq.channel.wizard.rightDistance': '右距离',
  'settings.eq.channel.wizard.rightLouder': '右边更响',
  'settings.eq.channel.wizard.rightSpl': '右 SPL',
  'settings.eq.channel.wizard.title': '空间校准向导',
  'settings.eq.comfort.direct': '原声直通',
  'settings.eq.comfort.directDetail': 'DSP 关闭时不压低音量、不改动采样，适合放心听原声。',
  'settings.eq.comfort.risk': '需要留意电平',
  'settings.eq.comfort.riskDetail': '检测到潜在削波或保护动作，建议先预留 -6 dB Headroom。',
  'settings.eq.comfort.tuned': '正在修饰声音',
  'settings.eq.comfort.tunedDetail': '只处理已开启的 DSP 模块；关闭后会回到原生播放路径。',
  'settings.eq.curve.aria': '可拖动 31 段 EQ 频响曲线',
  'settings.eq.curve.dragBand': '拖动 {frequency} EQ 频段',
  'settings.eq.curve.fineEdit': 'Shift 细调',
  'settings.eq.curve.freeFrequency': '自由频率',
  'settings.eq.curve.snapped': '标准吸附',
  'settings.eq.error.bridgeChannelBalance': '桌面桥接不可用。请在 ECHO Next 桌面端控制声道平衡。',
  'settings.eq.error.bridgeControlEq': '桌面桥接不可用。请在 ECHO Next 桌面端控制 EQ。',
  'settings.eq.error.bridgeDeletePreset': '桌面桥接不可用。请在 ECHO Next 桌面端删除 EQ 预设。',
  'settings.eq.error.bridgeSavePreset': '桌面桥接不可用。请在 ECHO Next 桌面端保存 EQ 预设。',
  'settings.eq.error.presetName': '请输入预设名称。',
  'settings.eq.error.profileName': '请输入配置档名称。',
  'settings.eq.error.profileTarget': '请选择一个配置档。',
  'settings.eq.export.successApo': '已导出 Equalizer APO 配置：{path}',
  'settings.eq.export.successGraphicEq': '已导出 GraphicEQ 配置：{path}',
  'settings.eq.export.successPreset': '已导出 EQ 预设：{path}',
  'settings.eq.import.filters': 'Filter',
  'settings.eq.import.filtersValue': '{count} 导入 / {skipped} 跳过',
  'settings.eq.import.filterPreview': 'Filter 明细',
  'settings.eq.import.filterEnabledAria': '导入 Filter {index} 启用状态',
  'settings.eq.import.filterFrequencyAria': '导入 Filter {index} 频率',
  'settings.eq.import.filterGainAria': '导入 Filter {index} 增益',
  'settings.eq.import.filterQAria': '导入 Filter {index} Q',
  'settings.eq.import.filterTypeAria': '导入 Filter {index} 类型',
  'settings.eq.import.estimatedPeak': '预计峰值',
  'settings.eq.import.graphicEq': 'GraphicEQ 点',
  'settings.eq.import.includes': 'Include 文件',
  'settings.eq.import.includesValue': '{count} 展开 / {skipped} 跳过',
  'settings.eq.import.maxBoost': '最大提升',
  'settings.eq.import.maxCut': '最大削减',
  'settings.eq.import.apoDirectives': 'APO 指令',
  'settings.eq.import.apoDirectiveDetails': '指令明细',
  'settings.eq.import.apoDirectivesValue': '{count} 识别 / {skipped} 声道 Filter 跳过',
  'settings.eq.import.bandwidthFilters': 'BW 换算',
  'settings.eq.import.bandwidthFiltersValue': '{count} 条转为 Q',
  'settings.eq.import.compatibility': '兼容性',
  'settings.eq.import.compatibility.adjusted': '已换算',
  'settings.eq.import.compatibility.clean': '完整导入',
  'settings.eq.import.compatibility.partial': '部分导入',
  'settings.eq.import.moreFilters': '还有 {count} 条 Filter 未显示',
  'settings.eq.import.noFilters': '没有需要显示的有效滤波器。',
  'settings.eq.import.preamp': 'Preamp',
  'settings.eq.import.preampAria': '导入预设 Preamp',
  'settings.eq.import.safePreamp': '建议余量',
  'settings.eq.import.safetyDetail': '按当前 Filter 粗略估算，应用前可先留出安全余量。',
  'settings.eq.import.safetyNeedsHeadroom': '需要安全余量',
  'settings.eq.import.safetyOk': '余量看起来安全',
  'settings.eq.import.safetyTitle': '导入听感安全',
  'settings.eq.import.audition': '试听导入',
  'settings.eq.import.auditionPresetName': '试听 {name}',
  'settings.eq.import.restoreAudition': '恢复原设置',
  'settings.eq.import.clearPaste': '清空',
  'settings.eq.import.applyPreview': '应用导入',
  'settings.eq.import.cancelPreview': '取消导入',
  'settings.eq.import.pasteDefaultName': '粘贴的 APO',
  'settings.eq.import.pasteEmpty': '请先粘贴 Equalizer APO 配置。',
  'settings.eq.import.pasteFileName': '粘贴内容',
  'settings.eq.import.pasteIncludeWarning': '粘贴导入不会读取 Include 文件；如需展开 Include，请使用文件导入。',
  'settings.eq.import.pasteTitle': 'APO 文本',
  'settings.eq.import.previewPaste': '预览 APO',
  'settings.eq.import.previewTitle': '导入预览',
  'settings.eq.import.reportTitle': '导入完成',
  'settings.eq.import.source': '来源',
  'settings.eq.import.sourceApo': 'Equalizer APO',
  'settings.eq.import.sourceEcho': 'ECHO JSON',
  'settings.eq.import.updateAudition': '更新试听',
  'settings.eq.import.useSafePreamp': '使用建议余量',
  'settings.eq.filter.highShelf': '高架',
  'settings.eq.filter.highPass': '高通',
  'settings.eq.filter.lowShelf': '低架',
  'settings.eq.filter.lowPass': '低通',
  'settings.eq.filter.notch': '陷波',
  'settings.eq.filter.peaking': '峰值',
  'settings.eq.headphoneCorrection.ab': '耳机校正 A/B',
  'settings.eq.headphoneCorrection.compareCorrected': '校正后',
  'settings.eq.headphoneCorrection.compareOriginal': '对比原声',
  'settings.eq.headphoneCorrection.convert': '转为自定义 EQ',
  'settings.eq.headphoneCorrection.customName': '自定义 EQ - {name}',
  'settings.eq.headphoneCorrection.lockAria': '耳机校正 EQ 锁定提示',
  'settings.eq.headphoneCorrection.lockDetail': '{name} 由耳机校正管理。要手动改参数，先转为自定义 EQ。',
  'settings.eq.headphoneCorrection.lockedError': '这个 OPRA preset 由耳机校正管理。请先点“转为自定义 EQ”再修改参数。',
  'settings.eq.headphoneCorrection.managed': '由耳机校正管理',
  'settings.eq.level.clips': '削波 {count}',
  'settings.eq.level.estimatedOutputPeak': '估算输出峰值',
  'settings.eq.level.headroom': '余量',
  'settings.eq.level.inputPeak': '输入峰值',
  'settings.eq.level.inputRms': '输入 RMS',
  'settings.eq.level.sourceEstimate': 'pre-native + DSP 估算',
  'settings.eq.preamp.aria': 'EQ 前级增益',
  'settings.eq.preamp.inputSafety': 'Headroom 管理',
  'settings.eq.preamp.maxBoost': '最大提升',
  'settings.eq.preamp.metricsAria': '安全余量指标',
  'settings.eq.preamp.recommended': '建议',
  'settings.eq.preamp.safeHeadroom': '安全余量',
  'settings.eq.signal.armed': '待命',
  'settings.eq.signal.bitPerfectOutput': 'Bit-perfect 路径',
  'settings.eq.signal.dspActive': 'DSP 信号链已启用',
  'settings.eq.signal.dspOutput': 'DSP 输出',
  'settings.eq.signal.input': '输入',
  'settings.eq.signal.limiter': '保护',
  'settings.eq.signal.output': '输出',
  'settings.eq.signal.peq': 'PEQ',
  'settings.eq.signal.preamp': '前级',
  'settings.eq.signal.protecting': '保护中',
  'settings.eq.signal.title': '信号链',
  'settings.eq.simpleAction.customPresetName': '我的 EQ 听感',
  'settings.eq.simpleAction.lastTweak': '上一下',
  'settings.eq.simpleAction.nextVibe': '换个听感',
  'settings.eq.simpleAction.nextVibeDetail': '试试看',
  'settings.eq.simpleAction.savedPresetName': '{name} {amount}%',
  'settings.eq.simpleAction.saveVibe': '保存听感',
  'settings.eq.simpleAction.saveVibeDetail': '保存当前',
  'settings.eq.simpleInsight.amount': '强度',
  'settings.eq.simpleInsight.aria': 'Simple 当前听感摘要',
  'settings.eq.simpleInsight.custom': '手动听感',
  'settings.eq.simpleInsight.mainChange': '主要变化',
  'settings.eq.simpleInsight.ready': '就绪',
  'settings.eq.simpleInsight.vibe': '当前听感',
  'settings.eq.simpleSafety.action': '留出余量',
  'settings.eq.simpleSafety.aria': 'Simple 安全余量',
  'settings.eq.simpleSafety.risk': '需要余量',
  'settings.eq.simpleSafety.riskDetail': '峰值 {peak} / 建议 {preamp}',
  'settings.eq.simpleSafety.safe': '余量安心',
  'settings.eq.simpleSafety.safeDetail': '峰值 {peak} / 前级 {preamp}',
  'settings.eq.simpleTone.air': '空气感',
  'settings.eq.simpleTone.airDetail': '更亮更开阔',
  'settings.eq.simpleTone.amount': '味道强度',
  'settings.eq.simpleTone.amountAria': 'Simple 听感强度',
  'settings.eq.simpleTone.aria': 'Simple 听感快捷调节',
  'settings.eq.simpleTone.bass': '低频弹性',
  'settings.eq.simpleTone.bassDetail': '鼓点更饱满',
  'settings.eq.simpleTone.flat': '恢复平直',
  'settings.eq.simpleTone.flatDetail': '回到原点',
  'settings.eq.simpleTone.less': '淡一点',
  'settings.eq.simpleTone.more': '浓一点',
  'settings.eq.simpleTone.vocal': '人声靠前',
  'settings.eq.simpleTone.vocalDetail': '歌词更清楚',
  'settings.eq.simpleTone.warm': '暖一点',
  'settings.eq.simpleTone.warmDetail': '柔和耐听',
  'settings.eq.simpleZone.air': '空气感',
  'settings.eq.simpleZone.airDetail': '亮度和空间',
  'settings.eq.simpleZone.applyAria': '应用{zone}听感，当前{value}',
  'settings.eq.simpleZone.aria': 'Simple 听感区域变化',
  'settings.eq.simpleZone.low': '低频',
  'settings.eq.simpleZone.lowDetail': '鼓点和厚度',
  'settings.eq.simpleZone.neutral': '平直',
  'settings.eq.simpleZone.vocal': '人声',
  'settings.eq.simpleZone.vocalDetail': '歌词和存在感',
  'settings.eq.routing.action.armHeadroom6': '预设 -6dB 余量',
  'settings.eq.routing.action.nativeDirect': '原生直通',
  'settings.eq.routing.armed': '已待命',
  'settings.eq.routing.dspPath': 'DSP 路径',
  'settings.eq.routing.dspPathDetail': '当前处理会明确显示在链路中。',
  'settings.eq.routing.headroomActiveDetail': '余量正在 DSP 路径中生效。',
  'settings.eq.routing.headroomStandby': '余量待命',
  'settings.eq.routing.headroomStandbyDetail': '仅在启用 DSP 后生效。',
  'settings.eq.routing.modules': '模块',
  'settings.eq.routing.modulesActiveDetail': '下方会显示每个启用的处理阶段。',
  'settings.eq.routing.modulesBypassed': '已旁路',
  'settings.eq.routing.modulesBypassedDetail': 'EQ / FIR / Balance 均关闭。',
  'settings.eq.routing.nativeBypassComfort': 'DSP 旁路时会保持原生直通，样本不会被效果链改动。',
  'settings.eq.routing.nativeDirect': '原生直通',
  'settings.eq.routing.nativeDirectDetail': 'DSP 旁路时不会改动原生播放。',
  'settings.eq.routing.nativeNoGainDetail': '原生直通下不做增益衰减。',
  'settings.eq.routing.playbackPath': '播放路径',
  'settings.eq.routing.protectActive': '保护中',
  'settings.eq.routing.protectActiveDetail': 'Limiter 正在防止过载。',
  'settings.eq.routing.safety': '安全',
  'settings.eq.headroom.dsp': 'DSP 余量',
  'settings.eq.headroom.nativeBypassNote': '仅在 EQ / FIR / Balance 启用时生效，原生旁路保持直通。',
  'settings.eq.headroom.presetsAria': 'DSP 余量快捷档位',  'settings.eq.profile.bound': '{output} 已绑定 {profile}',
  'settings.eq.profile.empty': '未选择配置档',
  'settings.eq.profile.nameAria': 'EQ 配置档名称',
  'settings.eq.profile.namePlaceholder': '保存为配置档',
  'settings.eq.profile.noOutput': '当前输出',
  'settings.eq.profile.selectorAria': 'EQ 配置档',
  'settings.eq.profile.title': '配置档',
  'settings.eq.profile.unbound': '{output} 未绑定配置档',
  'settings.eq.preset.approximation': '31 段近似',
  'settings.eq.preset.builtIn': '内置预设',
  'settings.eq.preset.copyName': '{name} 副本',
  'settings.eq.preset.filter.all': '全部',
  'settings.eq.preset.filter.builtIn': '内置',
  'settings.eq.preset.filter.genre': '风格',
  'settings.eq.preset.filter.target': '目标曲线',
  'settings.eq.preset.filter.user': '用户',
  'settings.eq.preset.filter.utility': '工具',
  'settings.eq.preset.filterAria': '预设筛选',
  'settings.eq.preset.meta.approximationCaution': '这是 31 段图示 EQ 近似，不是精确耳机校准。',
  'settings.eq.preset.meta.genrePurpose': '用于快速塑造音乐风格取向。',
  'settings.eq.preset.meta.genreScenario': '适合按曲风试听，再按设备微调。',
  'settings.eq.preset.meta.targetPurpose': '用于接近常见听感目标曲线。',
  'settings.eq.preset.meta.targetScenario': '适合耳机或近场系统的目标曲线对比。',
  'settings.eq.preset.meta.tasteCaution': '这是听感取向，不是校准结果。',
  'settings.eq.preset.meta.type.animeJpop': '樱色电波',
  'settings.eq.preset.meta.type.acousticSilk': '弦木柔光',
  'settings.eq.preset.meta.type.bassBoost': '深海低频',
  'settings.eq.preset.meta.type.bkRoomCurve': '木厅曲线',
  'settings.eq.preset.meta.type.broadcastVoice': '电台近语',
  'settings.eq.preset.meta.type.bluetoothSpeakerCleanup': '蓝牙清场',
  'settings.eq.preset.meta.type.classicSmiley': '晨弧微笑',
  'settings.eq.preset.meta.type.classical': '星厅古典',
  'settings.eq.preset.meta.type.cinemaOrchestra': '银幕纵深',
  'settings.eq.preset.meta.type.cityPop': '霓虹夜航',
  'settings.eq.preset.meta.type.diffuseField': '漫野扩散',
  'settings.eq.preset.meta.type.femaleVocalAir': '清露女声',
  'settings.eq.preset.meta.type.flat': '原音如初',
  'settings.eq.preset.meta.type.harmanInEar': '入耳晨光',
  'settings.eq.preset.meta.type.harmanTarget': '暖场哈曼',
  'settings.eq.preset.meta.type.headphoneNotch': '耳峰细修',
  'settings.eq.preset.meta.type.headphoneWarm': '绒暖耳机',
  'settings.eq.preset.meta.type.liveHouse': '小馆现场',
  'settings.eq.preset.meta.type.lofiDusk': '雨窗低保真',
  'settings.eq.preset.meta.type.loudness': '暮色响度',
  'settings.eq.preset.meta.type.night': '月下轻听',
  'settings.eq.preset.meta.type.pianoRoom': '琴房微光',
  'settings.eq.preset.meta.type.rock': '黑曜摇滚',
  'settings.eq.preset.meta.type.sibilanceTamer': '齿音柔化',
  'settings.eq.preset.meta.type.studioNeutral': '录音室白描',
  'settings.eq.preset.meta.type.subCleanup': '潜波净化',
  'settings.eq.preset.meta.type.subsonicFilter': '暗涌滤波',
  'settings.eq.preset.meta.type.trebleSparkle': '银砂高频',
  'settings.eq.preset.meta.type.vinylWarmth': '黑胶余温',
  'settings.eq.preset.meta.type.vocalClear': '人声如绸',
  'settings.eq.preset.meta.type.vocalDeEss': '雪绒去齿',
  'settings.eq.preset.meta.utilityCaution': '工具型预设会改变监听判断，请确认后再保存。',
  'settings.eq.preset.meta.utilityPurpose': '用于检查、补偿或更安全的监听。',
  'settings.eq.preset.meta.utilityScenario': '适合定位问题、降低疲劳或做快速对比。',
  'settings.eq.preset.modified': '已修改',
  'settings.eq.preset.nameAria': '预设名称',
  'settings.eq.preset.readonly': '内置预设为只读。',
  'settings.eq.preset.savePlaceholder': '保存为用户预设',
  'settings.eq.preset.searchAria': '搜索预设',
  'settings.eq.preset.searchPlaceholder': '搜索预设',
  'settings.eq.preset.selectorAria': 'EQ 预设',
  'settings.eq.preset.user': '用户预设',
  'settings.eq.state.eqDisabled': 'EQ 已关闭',
  'settings.eq.state.eqEnabled': 'EQ 已启用',
  'settings.eq.status.bitPerfect': 'Bit-perfect',
  'settings.eq.status.clippingRisk': '削波风险',
  'settings.eq.status.eq': 'EQ',
  'settings.eq.status.estimatedPeak': '估算峰值',
  'settings.eq.status.headroom': '余量',
  'settings.eq.status.preamp': '前级',
  'settings.eq.status.preset': '预设',
  'settings.eq.status.processor': '处理器',
  'settings.eq.status.realtimeIir': '实时 IIR',
  'settings.eq.status.safe': '安全',
  'settings.eq.status.safeHeadroomShort': '安全余量',
  'settings.eq.status.warning': '警告',
  'settings.eq.mode.aria': 'EQ 显示模式',
  'settings.eq.mode.current': '模式',
  'settings.eq.mode.pro': 'Pro',
  'settings.eq.mode.simple': 'Simple',
  'settings.eq.section.channel': '声道与监听工具',
  'settings.eq.section.compare': 'A/B 与旁路对比',
  'settings.eq.subtitle': '声音曲线、安全余量与高级调音',
  'settings.eq.title': 'EQ',
  'settings.eq.warning.channelClipping': '存在削波风险：降低增益或前级可获得更安全的余量。',
  'settings.eq.warning.lowerPreamp': '降低前级可避免削波。',
  'settings.nav.about.description': '版本、更新与开发工具',
  'settings.nav.about.label': '关于 / 高级',
  'settings.nav.appearance.description': '主题、字体、背景',
  'settings.nav.appearance.label': '外观',
  'settings.nav.danger.description': '恢复与网络安全',
  'settings.nav.danger.label': '危险操作',
  'settings.nav.eq.description': '均衡器与输出安全',
  'settings.nav.eq.label': 'EQ',
  'settings.nav.general.description': '语言、窗口与基础行为',
  'settings.nav.general.label': '通用',
  'settings.nav.integrations.description': '账号登录、Discord、外部设备',
  'settings.nav.integrations.label': '联动',
  'settings.nav.library.description': '导入、扫描与清理',
  'settings.nav.library.label': '媒体库',
  'settings.nav.playback.description': '输出、缓冲与播放控制',
  'settings.nav.playback.label': '播放',
  'settings.nav.plugins.description': '本地扩展、权限和脚本',
  'settings.nav.plugins.label': '插件',
  'settings.plugins.card.title': '本地插件',
  'settings.plugins.card.description': '插件默认放在 userData/plugins 下，用户可以直接编辑 echo.plugin.json、plugin.js 和面板文件。',
  'settings.plugins.meta.runtime': '运行方式',
  'settings.plugins.meta.runtimeValue': '本地沙箱',
  'settings.plugins.meta.defaultState': '默认状态',
  'settings.plugins.meta.defaultStateValue': '手动启用',
  'settings.plugins.meta.permissions': '权限',
  'settings.plugins.meta.permissionsValue': '启用时确认',
  'settings.plugins.meta.playbackSafety': '播放安全',
  'settings.plugins.meta.playbackSafetyValue': '不进入音频热路径',
  'settings.plugins.action.openPage': '打开插件页',
  'settings.plugins.action.openDirectory': '打开插件目录',
  'settings.plugins.action.createExample': '新建示例插件',
  'settings.plugins.action.openDocs': '查看插件文档',
  'settings.plugins.note': '插件页负责启用、禁用、重载、命令和日志；这里保留入口和安全边界说明，避免两套管理 UI 分叉。',
  'settings.nav.remote.description': 'NAS、WebDAV、Subsonic',
  'settings.nav.remote.label': '网盘 / 远程',
  'settings.nav.shortcuts.description': '快捷键设置',
  'settings.nav.shortcuts.label': '快捷键',
  'settings.playback.audioStatus.description': '采样率字段必须分开显示，避免旧 ECHO 独占模式 48k 锁死回归。',
  'settings.playback.audioStatus.title': '音频状态',
  'settings.playback.advancedPanel.action.collapse': '收起高级播放设置',
  'settings.playback.advancedPanel.action.expand': '展开高级播放设置',
  'settings.playback.advancedPanel.description': '低负载、诊断、JUCE / DSD、导出和细节播放控制默认收起，避免干扰常用输出设置。',
  'settings.playback.advancedPanel.memory': '会记住展开状态',
  'settings.playback.advancedPanel.title': '高级播放设置',
  'settings.playback.asioNativeDsd.description': '默认关闭。仅在 ASIO + 本地 DSF + DoP 开启且无 EQ/音量/变速/DSP 时尝试；失败会退回现有 DoP/PCM。',
  'settings.playback.asioNativeDsd.title': 'ASIO 原生 DSD 实验',
  'settings.playback.automix.description': '默认关闭。开启后，连续队列会提前准备下一首，并用原生双 Deck 引擎避开尾部空白、智能衔接切歌。',
  'settings.playback.automix.title': 'Automix 智能过渡',
  'settings.playback.dsdDop.description': '默认关闭。本地 DSF 在 ASIO 下尝试 DoP 直出；失败会自动回退 FFmpeg PCM，最终以 DAC 显示为准。',
  'settings.playback.dsdDop.requiresAsio': '需要使用 ASIO',
  'settings.playback.dsdDop.title': 'DSD DoP 直出试验',
  'settings.playback.exportFormat.description': '底栏导出按钮使用这个格式；导出速度跟随当前播放速度。',
  'settings.playback.exportFormat.title': '音频导出格式',
  'settings.playback.fixedVolume.description': '开启后会将 ECHO 音量控制锁定为 100%；ReplayGain 仍会独立生效。',
  'settings.playback.fixedVolume.status.fixed': '已固定',
  'settings.playback.fixedVolume.title': '固定音量',
  'settings.playback.gapless.description': '本地同专辑相邻曲目 0 秒间隔，不淡入淡出；标准输出会临时转入原生 shared 链路。Automix 暂停期间保持独立。',
  'settings.playback.gapless.title': '专辑无缝播放',
  'settings.playback.transportFade.curve.equalPower': '等功率',
  'settings.playback.transportFade.curve.linear': '线性',
  'settings.playback.transportFade.curve.smooth': '平滑',
  'settings.playback.transportFade.description': '拖到 0 ms 关闭；开启后手动播放 / 暂停使用同一段淡入淡出时长。',
  'settings.playback.transportFade.field.curve': '曲线',
  'settings.playback.transportFade.field.duration': '时长',
  'settings.playback.transportFade.field.fadeIn': '淡入 ms',
  'settings.playback.transportFade.field.fadeOut': '淡出 ms',
  'settings.playback.transportFade.status.disabled': '未开启',
  'settings.playback.transportFade.status.enabled': '已开启',
  'settings.playback.transportFade.title': '播放暂停淡入淡出',
  'settings.playback.issueDiagnostics.description': '默认关闭。用户反馈播放异常时开启，会弹出浮窗记录状态、进度、duration、native 缓冲、underrun、backend、警告和 ended 标记。',
  'settings.playback.issueDiagnostics.title': '音频问题诊断窗口',
  'settings.playback.juceOutput.description': '默认关闭。FFmpeg 兼容路径作为默认输出；需要时可手动开启 JUCE 输出，失败时自动回退。',
  'settings.playback.juceOutput.title': 'JUCE 主输出',
  'settings.playback.miniPlayer.action.hide': '隐藏',
  'settings.playback.miniPlayer.action.show': '显示',
  'settings.playback.miniPlayer.autoHideNote': '打开迷你播放器时隐藏主界面到右下角托盘',
  'settings.playback.miniPlayer.description': '独立透明置顶小窗，只显示封面、歌名和进度；窗口会收紧到播放器本体，避免透明空白挡住其他软件。',
  'settings.playback.miniPlayer.status.hidden': '未显示',
  'settings.playback.miniPlayer.status.visible': '已显示',
  'settings.playback.miniPlayer.title': '迷你播放器',
  'settings.playback.monoAudio.description': '把左右声道合并后同时输出到两边；默认关闭，适合单耳听、坏声道耳机或临时检查混音。',
  'settings.playback.monoAudio.title': '单声道音频',
  'settings.playback.nativeDecode.description': '默认关闭。开启后，本地 WAV/FLAC/MP3 在无需重采样时使用长驻原生解码；MP3 走 Windows Media，失败会自动回退 FFmpeg。',
  'settings.playback.nativeDecode.title': '长驻原生解码',
  'settings.playback.outputDevice.description': '来自 echo-audio-host 的设备列表；没有设备时保持默认输出。',
  'settings.playback.outputDevice.empty': '无可用设备',
  'settings.playback.outputDevice.title': '输出设备',
  'settings.playback.outputMode.asio': 'ASIO',
  'settings.playback.outputMode.description': '普通耳机、蓝牙和电脑扬声器建议使用标准输出。WASAPI / ASIO / Exclusive 适合外置声卡和 HiFi 调试。',
  'settings.playback.outputMode.exclusive': 'Exclusive',
  'settings.playback.outputMode.shared': 'Shared',
  'settings.playback.outputMode.system': '标准输出（推荐）',
  'settings.playback.outputMode.title': '输出模式',
  'settings.playback.hqplayer.defaultBackend.ask': '每次询问',
  'settings.playback.hqplayer.defaultBackend.echoNative': '继续使用 ECHO 输出',
  'settings.playback.hqplayer.defaultBackend.hqplayer': '优先 HQPlayer',
  'settings.playback.hqplayer.description': '预留 HQPlayer 控制端点和播放交接偏好；默认不接管当前播放输出。',
  'settings.playback.hqplayer.enable': '启用 HQPlayer 集成',
  'settings.playback.hqplayer.field.defaultBackend': '默认交接',
  'settings.playback.hqplayer.field.endpoint': '控制端点',
  'settings.playback.hqplayer.field.lastChecked': '上次检测',
  'settings.playback.hqplayer.field.status': '状态',
  'settings.playback.hqplayer.host': 'Host',
  'settings.playback.hqplayer.mediaServer': 'ECHO 媒体服务',
  'settings.playback.hqplayer.mode.localDesktop': '本机 HQPlayer Desktop',
  'settings.playback.hqplayer.mode.remote': '远程 HQPlayer',
  'settings.playback.hqplayer.note': '当前只保存配置并测试 TCP 连通性，不会启动 HQPlayer，也不会改变 ECHO 当前播放链路。',
  'settings.playback.hqplayer.port': '控制端口',
  'settings.playback.hqplayer.profileName': '配置名',
  'settings.playback.hqplayer.result.failed': '连接不可用',
  'settings.playback.hqplayer.result.ok': '连接可用',
  'settings.playback.hqplayer.save': '保存',
  'settings.playback.hqplayer.saving': '保存中',
  'settings.playback.hqplayer.status.available': '可用',
  'settings.playback.hqplayer.status.checking': '检测中',
  'settings.playback.hqplayer.status.disabled': '未启用',
  'settings.playback.hqplayer.status.notConfigured': '未配置端口',
  'settings.playback.hqplayer.status.unavailable': '不可用',
  'settings.playback.hqplayer.test': '测试连接',
  'settings.playback.hqplayer.testing': '测试中',
  'settings.playback.hqplayer.title': 'HQPlayer 集成',
  'settings.playback.sharedBackend.description': 'DirectSound 只作为手动兼容模式，延迟较大；日常播放保持 WASAPI Shared。',
  'settings.playback.sharedBackend.alsa': 'ALSA',
  'settings.playback.sharedBackend.auto': '自动',
  'settings.playback.sharedBackend.directSound': 'DirectSound 兼容',
  'settings.playback.sharedBackend.linuxDescription': 'Linux 下默认优先 ALSA；如果系统把 PipeWire 接到 ALSA 兼容层，也会走这条共享输出路径。',
  'settings.playback.sharedBackend.title': '共享后端',
  'settings.playback.sharedBackend.wasapi': 'WASAPI Shared',
  'settings.playback.resetEngine.action': '重启音频引擎',
  'settings.playback.resetEngine.busy': '正在重启',
  'settings.playback.resetEngine.description': '停止当前播放并释放 native 音频主机；设备/驱动卡住时可先试这个，不必重开软件。',
  'settings.playback.resetEngine.done': '音频引擎已重启，你可以重新开始播放',
  'settings.playback.resetEngine.title': '重启音频引擎',
  'settings.playback.segmentLoop.description': '设置当前歌曲的 A/B 点、开启片段循环，并保存当前曲目的片段书签。',
  'settings.playback.segmentLoop.title': 'A-B 循环',
  'settings.playback.replayGain.action.advanced': '高级',
  'settings.playback.replayGain.action.analyzeMissing': '分析缺失音量',
  'settings.playback.replayGain.action.analyzing': '分析中...',
  'settings.playback.replayGain.description': '把不同歌曲的听感音量拉齐；只读取标签或写入 ECHO 数据库，不修改你的音乐文件。',
  'settings.playback.replayGain.error': '音量分析错误 {count} 个，已跳过问题文件。',
  'settings.playback.replayGain.field.applied': '当前应用',
  'settings.playback.replayGain.field.mode': '模式',
  'settings.playback.replayGain.field.preventClipping': '防削波',
  'settings.playback.replayGain.field.preamp': '前级增益',
  'settings.playback.replayGain.field.progress': '进度',
  'settings.playback.replayGain.field.target': '目标响度',
  'settings.playback.replayGain.mode.album': '专辑',
  'settings.playback.replayGain.mode.off': '关闭',
  'settings.playback.replayGain.mode.track': '单曲',
  'settings.playback.replayGain.notRun': '尚未运行',
  'settings.playback.replayGain.preset.quiet': '安静 (-18 LUFS)',
  'settings.playback.replayGain.preset.standard': '标准 (-14 LUFS)',
  'settings.playback.replayGain.status.disabled': '未开启',
  'settings.playback.replayGain.status.enabled': '已开启',
  'settings.playback.replayGain.title': '音量标准化',
  'settings.playback.replayGain.toggle.analyzeOnPlay': '播放时分析',
  'settings.playback.replayGain.toggle.analyzeOnScan': '扫描后分析',
  'settings.playback.replayGain.toggle.preventClipping': '防削波',
  'settings.playback.status.off': '关闭',
  'settings.playback.status.on': '开启',
  'settings.playback.troubleshooting.description': '如果声音卡住或设备列表不正常，点这里。软重启不会影响其他应用。',
  'settings.playback.troubleshooting.hardAction': '重启 Windows 音频服务',
  'settings.playback.troubleshooting.hardBusy': '正在重启 Windows 音频服务',
  'settings.playback.troubleshooting.hardConfirm': '这会中断所有应用的声音（Chrome、游戏、通话），并需要管理员权限。是否继续？',
  'settings.playback.troubleshooting.hardDone': 'Windows 音频服务已恢复，你可以重新开始播放',
  'settings.playback.troubleshooting.softAction': '重启音频引擎',
  'settings.playback.troubleshooting.softBusy': '正在重启音频引擎',
  'settings.playback.troubleshooting.softDone': '音频引擎已重启，你可以重新开始播放',
  'settings.playback.troubleshooting.title': '音频故障排除',
  'settings.playback.speedMode.description': '选择播放器底部速度滑条使用的变速方式。',
  'settings.playback.speedMode.title': '变速模式',
  'settings.playback.stability.action.copied': '已复制',
  'settings.playback.stability.action.copy': '复制诊断信息',
  'settings.playback.stability.action.refresh': '刷新播放稳定性诊断',
  'settings.playback.stability.error.desktopBridgeUnavailable': '桌面桥接不可用。',
  'settings.playback.stability.field.lastSharedStabilityRecoveryAt': '上次 Shared 稳定恢复时间',
  'settings.playback.stability.field.lastWatchdogRecoveryTime': '上次 watchdog 恢复时间',
  'settings.playback.stability.field.nativeBufferedFrames': 'Native 缓冲帧',
  'settings.playback.stability.field.nativeBufferedMs': 'Native 缓冲毫秒',
  'settings.playback.stability.field.nativeDeviceBufferFrames': '设备缓冲帧',
  'settings.playback.stability.field.nativeFifoCapacityFrames': 'Native FIFO 容量帧',
  'settings.playback.stability.field.nativeStartupPrebufferFrames': '启动预缓冲帧',
  'settings.playback.stability.field.nativeUnderrunCallbacks': 'Native underrun 回调',
  'settings.playback.stability.field.nativeUnderrunFrames': 'Native underrun 帧',
  'settings.playback.stability.field.recentWatchdogRecoveryCount': '近期 watchdog 恢复次数',
  'settings.playback.stability.field.sharedStabilityTier': 'Shared 稳定档',
  'settings.playback.stability.field.watchdogStatus': 'watchdog 状态',
  'settings.playback.stability.title': '播放稳定性诊断',
  'settings.playback.stability.value.unknown': '未知',
  'settings.playback.wireless.description': '后续 HiFi 引擎阶段再接入；当前阶段不迁移 gapless / automix / 流媒体。',
  'settings.playback.wireless.title': '无线播放',
  'settings.shortcuts.action.clear': '清除',
  'settings.shortcuts.action.bossKey.description': '立即隐藏窗口，并把 ECHO 音量降到 0。',
  'settings.shortcuts.action.bossKey.title': '老板键',
  'settings.shortcuts.action.nextTrack.description': '切到当前播放队列里的下一首。',
  'settings.shortcuts.action.nextTrack.title': '下一首',
  'settings.shortcuts.action.openAudioSettings.description': '打开底部播放器的音频设置抽屉。',
  'settings.shortcuts.action.openAudioSettings.title': '打开音频设置',
  'settings.shortcuts.action.openLyricsSettings.description': '打开歌词设置抽屉。',
  'settings.shortcuts.action.openLyricsSettings.title': '打开歌词设置',
  'settings.shortcuts.action.openMvSettings.description': '打开 MV 设置抽屉。',
  'settings.shortcuts.action.openMvSettings.title': '打开 MV 设置',
  'settings.shortcuts.action.locateCurrentTrack.description': '把当前列表滚动到正在播放的歌曲位置。',
  'settings.shortcuts.action.locateCurrentTrack.title': '定位到当前播放歌曲',
  'settings.shortcuts.action.playPause.description': '在全局范围切换播放和暂停。',
  'settings.shortcuts.action.playPause.title': '播放 / 暂停',
  'settings.shortcuts.action.previousTrack.description': '切到当前播放队列里的上一首。',
  'settings.shortcuts.action.previousTrack.title': '上一首',
  'settings.shortcuts.action.record': '录制',
  'settings.shortcuts.action.restoreRecommended': '恢复推荐',
  'settings.shortcuts.action.seekBackward.description': '当前歌曲向后退 10 秒。',
  'settings.shortcuts.action.seekBackward.title': '快退 10 秒',
  'settings.shortcuts.action.seekForward.description': '当前歌曲向前进 10 秒。',
  'settings.shortcuts.action.seekForward.title': '快进 10 秒',
  'settings.shortcuts.action.showMainWindow.description': '把 ECHO 主窗口带回前台。',
  'settings.shortcuts.action.showMainWindow.title': '显示主窗口',
  'settings.shortcuts.action.speedDown.description': '每次把播放速度降低 0.1x。',
  'settings.shortcuts.action.speedDown.title': '播放减速',
  'settings.shortcuts.action.speedUp.description': '每次把播放速度提高 0.1x。',
  'settings.shortcuts.action.speedUp.title': '播放加速',
  'settings.shortcuts.action.stop.description': '停止当前播放并释放播放状态。',
  'settings.shortcuts.action.stop.title': '停止播放',
  'settings.shortcuts.action.toggleDesktopLyrics.description': '打开或关闭桌面歌词窗口。',
  'settings.shortcuts.action.toggleDesktopLyrics.title': '打开 / 关闭桌面歌词',
  'settings.shortcuts.action.toggleDesktopLyricsLock.description': '切换桌面歌词鼠标穿透锁定状态。',
  'settings.shortcuts.action.toggleDesktopLyricsLock.title': '锁定 / 解锁歌词',
  'settings.shortcuts.action.volumeDown.description': '把 ECHO 音量降低 5%。',
  'settings.shortcuts.action.volumeDown.title': '音量降低',
  'settings.shortcuts.action.volumeUp.description': '把 ECHO 音量提高 5%。',
  'settings.shortcuts.action.volumeUp.title': '音量提高',
  'settings.shortcuts.column.function': '功能说明',
  'settings.shortcuts.column.local': '普通快捷键',
  'settings.shortcuts.column.global': '全局快捷键',
  'settings.shortcuts.description': '普通快捷键只有 ECHO 窗口聚焦时生效；全局快捷键在后台也生效，启用前会检查系统占用。',
  'settings.shortcuts.empty': '未绑定',
  'settings.shortcuts.localUnavailable': '仅全局',
  'settings.shortcuts.message.duplicate': '这个快捷键已经绑定到其他动作。',
  'settings.shortcuts.message.empty': '请先录制一个快捷键。',
  'settings.shortcuts.message.invalid': '这个按键目前不能作为快捷键。',
  'settings.shortcuts.message.safe': '这个快捷键可以使用。',
  'settings.shortcuts.message.unavailable': '这个快捷键已被系统或其他应用占用，已保持关闭。',
  'settings.shortcuts.message.unsafe': '这个按键目前不能作为快捷键；可以让小键盘输出标准键盘键或媒体键。',
  'settings.shortcuts.note': '支持单键、组合键、媒体键、宏键盘键和鼠标侧键；普通快捷键不会在输入框里触发。',
  'settings.shortcuts.recording': '按下新的快捷键...',
  'settings.shortcuts.scope.local': '普通快捷键',
  'settings.shortcuts.scope.global': '全局快捷键',
  'settings.shortcuts.title': '快捷键',
  'settings.remote.hero.title': '网盘 / 远程音乐库',
  'settings.remote.hero.summary': '网盘 / WebDAV / AList / NAS / Subsonic / Jellyfin / Emby',
  'settings.remote.hero.description': '连接 AList、坚果云、Nextcloud 等 WebDAV 网盘，也可以把 Jellyfin、Emby、Navidrome、NAS 或 SSHFS 作为独立音乐来源浏览。ECHO 会为远程歌曲建立本地索引，使歌词、MV、播放进度、收藏和历史记录正常工作。',
  'settings.remote.guardrail.aria': '远程库同步边界',
  'settings.remote.guardrail.title': '本地播放优先',
  'settings.remote.guardrail.description': '远程同步和封面/元数据补齐都在后台限速执行；播放活跃时会降并发。当前离线边界是索引、封面和小型元数据缓存，不会静默镜像整库音乐文件。',
  'settings.remote.coverPerformance.aria': '远程封面加载性能',
  'settings.remote.coverPerformance.title': '加载性能',
  'settings.remote.coverPerformance.description': '控制远程封面预热强度；只影响列表封面加载，不会改变播放取流。',
  'settings.remote.coverPerformance.groupAria': '远程封面加载性能档位',
  'settings.remote.coverPerformance.option.low': '省流量',
  'settings.remote.coverPerformance.option.low.description': '只预热当前可见封面，适合公网或弱服务器。',
  'settings.remote.coverPerformance.option.balanced': '均衡',
  'settings.remote.coverPerformance.option.balanced.description': '预热当前和后面约半屏到一屏，默认推荐。',
  'settings.remote.coverPerformance.option.aggressive': '积极预热',
  'settings.remote.coverPerformance.option.aggressive.description': '滚动停顿时提前拉取更多封面，适合局域网 Navidrome。',
  'settings.remote.coverPerformance.option.lan': '局域网极速',
  'settings.remote.coverPerformance.option.lan.description': '拉满远程封面预热和后台加载并发，适合本机、NAS 或稳定千兆局域网。',
  'settings.remote.albumMerge.aria': '远程专辑合并策略',
  'settings.remote.albumMerge.title': '专辑合并',
  'settings.remote.albumMerge.description': '只影响网盘 / 远程专辑列表的展示分组；不改本地库、不改文件标签、不影响播放。',
  'settings.remote.albumMerge.groupAria': '远程专辑合并档位',
  'settings.remote.albumMerge.option.conservative': '保守合并',
  'settings.remote.albumMerge.option.conservative.description': '优先使用服务器专辑 ID；普通网盘只合并同来源、同文件夹、同专辑的曲目。',
  'settings.remote.albumMerge.option.standard': '普通合并',
  'settings.remote.albumMerge.option.standard.description': '在保守边界上放宽标题差异，会合并大小写、符号和 - Single 这类远程专辑拆分。',
  'settings.remote.albumMerge.stat.current': '原专辑数量',
  'settings.remote.albumMerge.stat.target': '合并后数量',
  'settings.remote.albumMerge.stat.tracks': '已索引远程歌曲',
  'settings.remote.albumMerge.pending': '待扫描',
  'settings.remote.albumMerge.action.scan': '扫描远程曲库',
  'settings.remote.albumMerge.action.scanning': '扫描中...',
  'settings.remote.albumMerge.action.apply': '应用并重新整理分组',
  'settings.remote.albumMerge.action.applying': '重新整理中...',
  'settings.remote.library.description': '本阶段禁止网盘 / 远程 / 流媒体，只保留设置分组占位。',
  'settings.remote.library.title': '远程音乐库',
  'segmentLoop.action.clear': '清除当前 A-B 点',
  'segmentLoop.action.deleteBookmark': '删除片段书签 {label}',
  'segmentLoop.action.deleteBookmarkTitle': '删除片段书签',
  'segmentLoop.action.loopBookmark': '循环片段 {label}',
  'segmentLoop.action.loopBookmarkTitle': '循环 {label}',
  'segmentLoop.action.saveBookmark': '保存当前片段书签',
  'segmentLoop.action.setA': '把当前位置设为 A 点',
  'segmentLoop.action.setB': '把当前位置设为 B 点',
  'segmentLoop.action.toggle': '切换 A-B 循环',
  'segmentLoop.action.toggleTitle': '开启或关闭 A-B 循环',
  'segmentLoop.aria.bookmarks': '当前曲目的片段书签',
  'segmentLoop.aria.panel': 'A-B 循环和片段书签',
  'segmentLoop.empty': '保存片段后会显示在这里',
  'segmentLoop.notSet': '未设置',
  'spotifyPlayback.error.noDevice': '没有可用的 Spotify 播放设备。请开启“自动启动官方播放器”，或先打开 Spotify 桌面端/网页版。{hint}',
  'spotifyPlayback.error.noDrmKeysystem': '当前 Electron 构建没有可用的 DRM/Widevine keysystem，Spotify 官方播放器无法在 ECHO 内注册设备。',
};

const zhTW: TranslationMap = {
  ...zhCN,
  'app.window.restore': '還原',
  'app.window.fullscreen': '全螢幕',
  'app.window.exitFullscreen': '退出全螢幕',
  'albumTagEditor.action.applyToForm': '套用到表單',
  'albumTagEditor.action.cancel': '取消',
  'albumTagEditor.action.chooseCover': '選擇封面',
  'albumTagEditor.action.close': '關閉編輯標籤',
  'albumTagEditor.action.deleteAlbum': '刪除專輯',
  'albumTagEditor.action.loadEmbedded': '重讀嵌入標籤',
  'albumTagEditor.action.loading': '讀取中',
  'albumTagEditor.action.loadNetwork': '從網路載入',
  'albumTagEditor.action.openInExplorer': '從檔案總管開啟',
  'albumTagEditor.action.saveTags': '儲存標籤',
  'albumTagEditor.action.saving': '儲存中',
  'albumTagEditor.action.searchCandidates': '搜尋候選',
  'albumTagEditor.action.searching': '搜尋中',
  'albumTagEditor.albumSummary': '{count} 首 / {duration}',
  'albumTagEditor.cover.embeddedSuffix': ' / 已從嵌入標籤重新載入封面',
  'albumTagEditor.cover.localSuffix': ' / 本機封面：{path}',
  'albumTagEditor.cover.networkSuffix': ' / 網路封面會在儲存時下載並寫入',
  'albumTagEditor.currentAlbum': '目前專輯',
  'albumTagEditor.currentAlbumAria': '目前專輯',
  'albumTagEditor.discard.continue': '繼續編輯',
  'albumTagEditor.discard.discard': '捨棄更改',
  'albumTagEditor.discard.prompt': '有未儲存更改，確認關閉並捨棄嗎？',
  'albumTagEditor.duration.hoursMinutes': '{hours} 小時 {minutes} 分鐘',
  'albumTagEditor.duration.minutes': '{minutes} 分鐘',
  'albumTagEditor.duration.unknown': '未知時長',
  'albumTagEditor.error.chooseCoverUnsupported': '目前執行環境不支援選擇封面。',
  'albumTagEditor.error.embeddedUnsupported': '目前執行環境不支援讀取嵌入標籤。',
  'albumTagEditor.error.fixYearBeforeSave': '請先修正年份，再儲存標籤。',
  'albumTagEditor.error.networkTemporary': '網路來源暫時不可用，請稍後再試。',
  'albumTagEditor.error.networkUnsupported': '目前執行環境不支援網路標籤搜尋。',
  'albumTagEditor.error.noReadableTrack': '這張專輯沒有可讀取標籤的歌曲。',
  'albumTagEditor.error.openFolderUnsupported': '目前執行環境不支援開啟檔案總管。',
  'albumTagEditor.error.positiveInteger': '{label}必須是正整數或留空',
  'albumTagEditor.error.readTracksUnsupported': '目前執行環境不支援讀取專輯曲目。',
  'albumTagEditor.field.album': '專輯',
  'albumTagEditor.field.albumArtist': '專輯演出者',
  'albumTagEditor.field.cover': '封面',
  'albumTagEditor.field.genre': '曲風',
  'albumTagEditor.field.year': '年份',
  'albumTagEditor.message.appliedNetwork': '已套用到表單，點擊儲存後才會寫入專輯內歌曲。',
  'albumTagEditor.message.noNetworkTags': '沒有找到合適的網路標籤。',
  'albumTagEditor.message.searchingNetwork': '正在搜尋網路標籤...',
  'albumTagEditor.network.aria': '網路候選對比',
  'albumTagEditor.network.column.candidate': '候選',
  'albumTagEditor.network.column.current': '目前',
  'albumTagEditor.network.column.field': '欄位',
  'albumTagEditor.network.selectAll': '全選',
  'albumTagEditor.network.selectFields': '選擇要套用到專輯的欄位',
  'albumTagEditor.network.title': '網路候選',
  'albumTagEditor.saveDescription': '儲存會寫入這張專輯內所有歌曲的嵌入標籤，並立即同步媒體庫。',
  'albumTagEditor.section.albumInfo': '專輯資訊',
  'albumTagEditor.section.albumInfoDescription': '會批次寫入這張專輯內的歌曲',
  'albumTagEditor.subtitle.albumBatch': '專輯級批次標籤',
  'albumTagEditor.subtitle.unsaved': '未儲存更改',
  'albumTagEditor.title': '編輯標籤',
  'albumTagEditor.value.albumCandidate': '專輯候選',
  'albumTagEditor.value.empty': '空',
  'albumTagEditor.value.existingCover': '已有封面',
  'albumTagEditor.value.networkCover': '網路封面',
  'albumTagEditor.value.unknownAlbum': '未知專輯',
  'albumTagEditor.value.unknownArtist': '未知演出者',
  'firstRun.action.finish': '完成設定',
  'firstRun.action.next': '下一步',
  'firstRun.action.previous': '上一步',
  'firstRun.action.skip': '跳過',
  'firstRun.action.skipWizard': '跳過精靈',
  'firstRun.aria.steps': '首次啟動步驟',
  'firstRun.aria.summary': '目前精靈選擇摘要',
  'firstRun.audio.asio.description': '需要 ASIO 裝置和可靠驅動。',
  'firstRun.audio.asio.hint': '專業',
  'firstRun.audio.asio.label': 'ASIO',
  'firstRun.audio.exclusive.description': '獨佔裝置，適合確認穩定的外接音效卡或 HiFi 調試。',
  'firstRun.audio.exclusive.hint': '進階',
  'firstRun.audio.exclusive.label': 'WASAPI Exclusive',
  'firstRun.audio.linuxShared.description': '透過 Linux 音訊堆疊使用 ECHO 原生輸出。',
  'firstRun.audio.linuxShared.hint': '進階',
  'firstRun.audio.linuxShared.label': 'Linux Shared',
  'firstRun.audio.shared.description': '進階音訊引擎的日常共享輸出。',
  'firstRun.audio.shared.hint': '進階',
  'firstRun.audio.shared.label': 'WASAPI Shared',
  'firstRun.audio.system.description': '最穩定，適合一般耳機、藍牙、電腦喇叭。',
  'firstRun.audio.system.hint': '推薦',
  'firstRun.audio.system.label': '標準輸出（推薦）',
  'firstRun.accounts.cookie.description': '如果平台登入視窗不可用，再手動貼上 Cookie 並點「手動儲存」，儲存後用「檢查」確認狀態。',
  'firstRun.accounts.cookie.title': '備用方式',
  'firstRun.accounts.login.description': '網易雲、QQ 音樂、Bilibili、SoundCloud 等帳號優先點「登入並同步」，登入完成後 ECHO 會儲存必要憑證。',
  'firstRun.accounts.login.title': '優先使用網頁登入',
  'firstRun.accounts.note': '串流帳號是可選能力，不影響本地媒體庫播放；不同平台權限不同，ECHO 只會使用平台實際返回的可播放內容。',
  'firstRun.accounts.open.description': '完成精靈後進入「設定 > 整合 > 帳號登入」，這裡集中管理串流、MV、下載和歌詞相關帳號。',
  'firstRun.accounts.open.title': '入口位置',
  'firstRun.accounts.spotify.description': 'Spotify 走官方播放器/Connect，需要 Premium；它不會提供可下載音訊 URL。',
  'firstRun.accounts.spotify.title': 'Spotify 注意',
  'firstRun.cache.chooseLocation': '選擇快取位置',
  'firstRun.cache.useDefault': '使用預設',
  'firstRun.currentSelection': '目前選擇',
  'firstRun.defaultLocation': '預設位置',
  'firstRun.description': '按順序確認媒體庫、快取、掃描、輸出、外觀和帳號入口。不確定的地方保留推薦值即可。',
  'firstRun.error.desktopBridgeCache': '桌面橋接不可用，暫時不能選擇快取位置。',
  'firstRun.error.desktopBridgeMusicFolder': '桌面橋接不可用，暫時不能選擇音樂資料夾。',
  'firstRun.error.desktopBridgeSave': '桌面橋接不可用，暫時不能儲存首次啟動設定。',
  'firstRun.library.chooseFolder': '選擇資料夾',
  'firstRun.library.noneSelected': '未選擇，稍後新增也可以。',
  'firstRun.library.scanAfterFinish': '完成後掃描',
  'firstRun.message.saved': '首次啟動設定已儲存。',
  'firstRun.scan.balanced.description': '推薦。掃描速度和背景占用都比較穩。',
  'firstRun.scan.balanced.hint': '預設',
  'firstRun.scan.balanced.label': '均衡',
  'firstRun.scan.low.description': '更少打擾播放，掃描會慢一些。',
  'firstRun.scan.low.hint': '邊聽邊掃',
  'firstRun.scan.low.label': '低占用',
  'firstRun.scan.performance.description': '優先盡快建庫，適合電腦閒置時使用。',
  'firstRun.scan.performance.hint': '閒置時',
  'firstRun.scan.performance.label': '快速',
  'firstRun.step.audio.description': '一般耳機、藍牙和電腦喇叭建議使用標準輸出，穩定優先；外接音效卡、獨佔模式或 ASIO 只建議在確認裝置可靠後再啟用。',
  'firstRun.step.audio.eyebrow': '4 / 7',
  'firstRun.step.audio.label': '輸出',
  'firstRun.step.audio.title': '選擇音訊輸出',
  'firstRun.step.appearance.description': '這裡先決定整體明暗模式和主題配色。淺色適合白天和辦公環境，深色適合夜間；不確定就跟隨系統。',
  'firstRun.step.appearance.eyebrow': '5 / 7',
  'firstRun.step.appearance.label': '外觀',
  'firstRun.step.appearance.title': '選擇主題和明暗模式',
  'firstRun.step.accounts.description': '串流帳號可以稍後登入。它主要影響線上搜尋、歌單同步、MV/歌詞匹配和部分下載能力，不會替代本地媒體庫。',
  'firstRun.step.accounts.eyebrow': '6 / 7',
  'firstRun.step.accounts.label': '帳號',
  'firstRun.step.accounts.title': '串流帳號怎麼登入',
  'firstRun.step.cache.description': '封面、歌詞、MV 快取會占用磁碟空間。C 槽緊張時建議換到其他磁碟；之後也可以在設定裡調整。',
  'firstRun.step.cache.eyebrow': '2 / 7',
  'firstRun.step.cache.label': '快取',
  'firstRun.step.cache.title': '選擇快取位置',
  'firstRun.step.library.description': '選擇音樂根目錄後，ECHO 會讀取標籤、封面、時長和歌詞線索來建立媒體庫。檔案不會被移動或刪除，也可以先跳過。',
  'firstRun.step.library.eyebrow': '1 / 7',
  'firstRun.step.library.label': '音樂',
  'firstRun.step.library.title': '選擇音樂資料夾',
  'firstRun.step.scan.description': '首次掃描會比較忙。日常推薦均衡；如果正在聽歌或電腦負載高，用低占用；電腦閒置時再用快速。',
  'firstRun.step.scan.eyebrow': '3 / 7',
  'firstRun.step.scan.label': '掃描',
  'firstRun.step.scan.title': '選擇掃描方式',
  'firstRun.step.summary.description': '確認後只儲存這些基礎設定。之後可以在設定裡重新開啟首次啟動指引，帳號也可以隨時補登入。',
  'firstRun.step.summary.eyebrow': '7 / 7',
  'firstRun.step.summary.label': '確認',
  'firstRun.step.summary.title': '確認設定',
  'firstRun.summary.addLater': '稍後新增',
  'firstRun.summary.accounts': '帳號',
  'firstRun.summary.accountsLater': '稍後在設定 > 整合登入',
  'firstRun.summary.cache': '快取',
  'firstRun.summary.kicker': '摘要',
  'firstRun.summary.music': '音樂',
  'firstRun.summary.noFileMove': '不會移動或刪除你的音樂檔案。',
  'firstRun.summary.output': '輸出',
  'firstRun.summary.readyDescription': '點擊完成後儲存設定。若已選擇資料夾並勾選掃描，ECHO 會開始建立媒體庫索引。',
  'firstRun.summary.readyTitle': '可以開始了',
  'firstRun.summary.scan': '掃描',
  'firstRun.summary.scanWithFolder': '{mode}，完成後掃描',
  'firstRun.summary.theme': '外觀',
  'firstRun.summary.themeValue': '{mode}，{preset}',
  'firstRun.theme.dark.description': '降低夜間亮度，適合暗光環境和 OLED 螢幕。',
  'firstRun.theme.dark.hint': '夜間',
  'firstRun.theme.light.description': '文字更清楚，適合白天、辦公和截圖。',
  'firstRun.theme.light.hint': '清爽',
  'firstRun.theme.modeTitle': '明暗模式',
  'firstRun.theme.presetTitle': '主題配色',
  'firstRun.theme.system.description': '跟隨 Windows 或系統外觀自動切換。',
  'firstRun.theme.system.hint': '省心',
  'firstRun.title': '歡迎使用 ECHO Next',
  'downloads.action.addToQueue': '加入佇列',
  'downloads.action.cancelJob': '取消任務',
  'downloads.action.changeFolder': '更換資料夾',
  'downloads.action.checkTools': '檢測環境',
  'downloads.action.chooseFolder': '選擇資料夾',
  'downloads.action.clearCompleted': '清除已完成',
  'downloads.action.creating': '建立中',
  'downloads.action.search': '搜尋',
  'downloads.action.searching': '搜尋中',
  'downloads.description': '使用內建 yt-dlp 搜尋 YouTube / Bilibili，並只下載最高可用音訊。',
  'downloads.empty.noResults.description': '換個關鍵字再試試。',
  'downloads.empty.noResults.title': '暫無搜尋結果',
  'downloads.empty.queue.description': '貼上連結或從搜尋結果下載後，會在這裡看到真實進度。',
  'downloads.empty.queue.title': '佇列為空',
  'downloads.empty.searching.description': '正在查詢 {scope}。',
  'downloads.empty.searching.title': '正在搜尋',
  'downloads.error.cookieFallback': '無法讀取瀏覽器 Cookie，已自動嘗試不使用登入狀態搜尋。',
  'downloads.error.ipcUnavailable': '目前執行環境未暴露下載 IPC。',
  'downloads.error.operationFailed': '下載操作失敗',
  'downloads.folder.required': '請選擇下載資料夾',
  'downloads.job.imported': '已匯入媒體庫',
  'downloads.job.savedTo': '儲存到 {path}',
  'downloads.job.waitingProgress': '等待進度',
  'downloads.message.clearedTerminal': '已清除完成、失敗和取消的任務。',
  'downloads.message.completed': '下載完成：{title}',
  'downloads.message.queued': '已加入下載佇列。',
  'downloads.message.resultQueued': '已加入佇列：{title}',
  'downloads.queue.title': '下載佇列',
  'downloads.search.aria': '搜尋下載',
  'downloads.search.downloadAudio': '下載音訊',
  'downloads.search.joined': '已加入佇列',
  'downloads.search.placeholder': '搜尋歌曲、藝人或影片標題',
  'downloads.search.providerErrorItem': '{provider}：{error}',
  'downloads.search.providerErrors': '部分平台搜尋失敗：{errors}',
  'downloads.search.scopeAria': '搜尋平台',
  'downloads.search.title': '搜尋下載',
  'downloads.search.unknownUploader': '未知作者',
  'downloads.search.views': '{count} 次播放',
  'downloads.search.viewsWan': '{count} 萬次播放',
  'downloads.settings.audioStrategy': '音訊策略',
  'downloads.settings.bestAvailable': '最高可用音質',
  'downloads.settings.bindMvAfterImport': '匯入後綁定來源 URL 為 MV',
  'downloads.settings.importToLibrary': '完成後匯入媒體庫',
  'downloads.settings.outputDirectory': '下載資料夾',
  'downloads.settings.title': '下載設定',
  'downloads.status.bindingMv': '綁定 MV',
  'downloads.status.cancelled': '已取消',
  'downloads.status.completed': '已完成',
  'downloads.status.downloading': '下載中',
  'downloads.status.extractingAudio': '提取音訊',
  'downloads.status.failed': '失敗',
  'downloads.status.importing': '匯入媒體庫',
  'downloads.status.probing': '解析連結',
  'downloads.status.queued': '佇列中',
  'downloads.title': '下載',
  'downloads.tools.notBundled': '未隨應用程式安裝',
  'downloads.tools.notDetected': '未檢測到',
  'downloads.tools.title': '環境檢測',
  'downloads.url.placeholder': '貼上 YouTube / Bilibili / SoundCloud / osu! 連結',
  'downloads.url.title': '貼上連結下載',
  'albumMenu.action.addToPlaylist': '加入播放清單...',
  'albumMenu.action.addToQueue': '加入佇列',
  'albumMenu.action.copyCover': '複製專輯封面',
  'albumMenu.action.copyInfo': '複製專輯資訊',
  'albumMenu.action.deleteAlbum': '刪除專輯',
  'albumMenu.action.editTags': '編輯標籤',
  'albumMenu.action.likeAlbum': '喜歡專輯',
  'albumMenu.action.playAlbum': '播放專輯',
  'albumMenu.action.saveCover': '儲存專輯封面',
  'albumMenu.action.unlikeAlbum': '取消喜歡專輯',
  'albumMenu.playlistSubmenu.aria': '選擇播放清單',
  'albumMenu.playlistSubmenu.empty': '沒有本機播放清單',
  'albumMenu.playlistSubmenu.itemCount': '{count} 首',
  'albumMenu.playlistSubmenu.loading': '正在讀取播放清單...',
  'accountProvider.kugou': '酷狗音樂',
  'accountProvider.netease': '網易雲音樂',
  'accountProvider.unknown': '未知帳號',
  'desktopLyrics.aria.stage': '桌面歌詞',
  'desktopLyrics.control.close': '關閉',
  'desktopLyrics.control.colorSwatch': '顏色 {color}',
  'desktopLyrics.control.customColor': '自訂顏色',
  'desktopLyrics.control.decreaseFontSize': '縮小字號',
  'desktopLyrics.control.decreaseScale': '縮小',
  'desktopLyrics.control.increaseFontSize': '放大字號',
  'desktopLyrics.control.increaseScale': '放大',
  'desktopLyrics.control.lock': '鎖定',
  'desktopLyrics.control.resetPosition': '重設位置',
  'desktopLyrics.control.romanization': '桌面歌詞顯示羅馬音',
  'desktopLyrics.control.themeColor': '跟隨主題顏色',
  'desktopLyrics.control.translation': '桌面歌詞顯示翻譯',
  'desktopLyrics.control.translationShort': '譯',
  'desktopLyrics.primary.empty': '暫無歌詞',
  'desktopLyrics.primary.instrumental': '純音樂，請欣賞',
  'desktopLyrics.secondary.waiting': '等待播放',
  'lyricsView.empty.instrumental': '純音樂，請欣賞',
  'lyricsView.empty.noLyrics': '暫無歌詞',
  'mvPanel.action.close': '關閉',
  'mvPanel.action.copied': '已複製',
  'mvPanel.action.copy': '複製',
  'mvPanel.action.dismissUnavailable': '關閉 MV 不可用提示',
  'mvPanel.diagnostics.title': 'MV 診斷報告',
  'mvPanel.notice.unavailable': 'MV 不可用',
  'mvPanel.status.bilibiliBlocked': 'Bilibili 暫時拒絕解析，請稍後重試或外部開啟',
  'mvPanel.status.databaseUnread': 'MV 資料庫不可讀',
  'mvPanel.status.externalRequired': '目前 MV 需要外部播放',
  'mvPanel.status.inAppUnavailable': '目前 MV 無法在應用程式內播放',
  'mvPanel.status.loadFailed': 'MV 載入失敗',
  'mvPanel.status.loading': '正在載入 MV',
  'mvPanel.status.localUnsupported': '本機影片格式不支援',
  'mvPanel.status.missingUrl': '缺少可播放位址',
  'mvPanel.status.networkFailed': '網路 MV 請求失敗',
  'mvPanel.status.notFound': '找不到可播放 MV',
  'mvPanel.status.temporaryPlayback': '臨時 MV 播放中，資料庫待修復',
  'mvPanel.status.unavailable': 'MV 不可用',
  'mvPanel.status.videoFailed': '影片載入失敗',
  'miniPlayer.action.close': '關閉迷你播放器',
  'miniPlayer.action.closeQueue': '收起播放佇列',
  'miniPlayer.action.closeShort': '關閉',
  'miniPlayer.action.next': '下一首',
  'miniPlayer.action.openQueue': '開啟播放佇列',
  'miniPlayer.action.pause': '暫停',
  'miniPlayer.action.play': '播放',
  'miniPlayer.action.previous': '上一首',
  'miniPlayer.action.resetPosition': '重置位置',
  'miniPlayer.action.volume': '調整音量',
  'miniPlayer.aria.progress': '播放進度',
  'miniPlayer.aria.queue': '播放佇列',
  'miniPlayer.aria.shell': '迷你播放器',
  'miniPlayer.aria.volume': '音量',
  'miniPlayer.artist.unknown': '未知演出者',
  'miniPlayer.status.hqPlayerTakeover': 'HQPlayer 接管中',
  'miniPlayer.status.queueEmpty': '佇列為空',
  'miniPlayer.status.ready': '就緒',
  'playerStatus.audioSpecifications': '音訊規格',
  'playerStatus.ready': '就緒',
  'playerStatus.streaming': '串流媒體',
  'playerSpeed.label': '播放速度',
  'playerSpeed.reset': '重置播放速度',
  'playerVolume.fixed.disable': '關閉固定音量',
  'playerVolume.fixed.enable': '開啟固定音量',
  'playerVolume.fixed.enabled': '固定音量已開啟',
  'playerVolume.fixed.dsdAutoLocked': 'DSD 播放中已自動鎖定音量',
  'playerVolume.fixed.title': '固定音量',
  'import.dragDrop.desktopBridgeUnavailable': '桌面橋接不可用。請在 ECHO Next 桌面端匯入拖放檔案。',
  'import.dragDrop.files.empty': '找不到可匯入的音訊檔案。',
  'import.dragDrop.files.failed': '{count} 個檔案匯入失敗',
  'import.dragDrop.files.ignored': '忽略 {count} 個不支援檔案',
  'import.dragDrop.files.imported': '已匯入 {count} 首歌曲',
  'import.dragDrop.files.summaryWithOutput': '{summary}。檔案已儲存到：{outputDirectory}',
  'import.dragDrop.noDroppedFiles': '未讀取到拖放檔案。',
  'import.dragDrop.overlay.description': '檔案會儲存到下載資料夾並加入曲庫',
  'import.dragDrop.overlay.title': '拖入音樂或 osu! 譜面以匯入曲庫',
  'import.dragDrop.paths.addedFolders': '已新增 {count} 個資料夾',
  'import.dragDrop.paths.empty': '找不到可匯入的音樂檔案或資料夾',
  'import.dragDrop.paths.failed': '{count} 個路徑匯入失敗',
  'import.dragDrop.paths.ignored': '忽略 {count} 個不支援檔案',
  'import.dragDrop.paths.importedFiles': '已匯入 {count} 個檔案',
  'import.dragDrop.paths.missing': '跳過 {count} 個無法存取的路徑',
  'import.dragDrop.paths.scannedAudioFolders': '已掃描 {count} 個音樂檔案所在資料夾',
  'notice.accountExpired': '帳號登入狀態可能已失效：{names}。請到設定 > 整合重新登入。',
  'notice.accountExpired.title': '帳號登入失效',
  'notice.action.close': '關閉',
  'notice.action.closeNotice': '關閉提示',
  'notice.action.ignore': '忽略',
  'notice.action.openReport': '開啟報告',
  'notice.audioError.description': '已產生 Markdown 診斷報告，裡面有詳細原因與排查線索。',
  'notice.audioError.title': '音訊錯誤',
  'notice.audioDefaultFormatWarning': '音訊設定提醒：Windows 預設格式設定偏高，目前是 {rate}。ECHO 只會提醒，不會修改系統設定；建議改到 48 kHz。',
  'notice.diagnosticsCrash.description': '上次 ECHO Next 未正常結束，已準備 Markdown 報告用於排查。',
  'notice.importFiles.empty': '沒有可匯入的音訊檔案。',
  'notice.importFiles.failed': '{count} 個檔案匯入失敗',
  'notice.importFiles.imported': '已加入曲庫 {count} 個檔案',
  'notice.importFiles.skipped': '略過 {count} 個不支援或不可用檔案',
  'notice.openFiles.partial': '已開啟 {opened} 個檔案，略過 {rejected} 個不支援或不可用檔案。',
  'notice.reportOpened': 'Markdown 報告已開啟。',
  'notice.reportOpenedPath': 'Markdown 報告已開啟：{path}',
  'notice.updateAvailable': '發現 ECHO NEXT 新版本。',
  'notice.updateAvailableVersion': '發現 ECHO NEXT 新版本 {version}。',
  'notice.updateDownloaded': 'ECHO NEXT 更新已下載完成，準備安裝。',
  'notice.updateDownloadedVersion': 'ECHO NEXT {version} 已下載完成，準備安裝。',
  'punctuation.clauseSeparator': '，',
  'punctuation.listSeparator': '、',
  'library.action.refresh': '重新整理',
  'albumDetail.action.addToQueue': '加入佇列',
  'albumDetail.action.back': '專輯',
  'albumDetail.action.likeAlbum': '喜歡專輯',
  'albumDetail.action.more': '更多專輯操作',
  'albumDetail.action.openSource': '開啟來源',
  'albumDetail.action.playNow': '立即播放',
  'albumDetail.action.readingAlbum': '正在讀取專輯',
  'albumDetail.action.refresh': '重新整理',
  'albumDetail.action.showInFolder': '在資料夾中顯示',
  'albumDetail.action.unlikeAlbum': '取消喜歡專輯',
  'albumDetail.aria.details': '{album} 專輯詳情',
  'albumDetail.aria.info': '專輯資訊',
  'albumDetail.aria.metadata': '專輯中繼資料',
  'albumDetail.aria.openArtist': '開啟藝術家 {artist}',
  'albumDetail.aria.sections': '專輯分區',
  'albumDetail.aria.trackConsole': '{album} 曲目控制台',
  'albumDetail.artist.notFound': '找不到藝術家：{artist}',
  'albumDetail.count.albums': '{count} 張專輯',
  'albumDetail.count.loadedAlbums': '{loaded}/{total} 張專輯',
  'albumDetail.count.loadedTracks': '{loaded}/{total} 首歌',
  'albumDetail.count.tracks': '{count} 首歌',
  'albumDetail.credit.role.arrangement': '編曲',
  'albumDetail.credit.role.engineering': '錄音與工程',
  'albumDetail.credit.role.label': '發行與廠牌',
  'albumDetail.credit.role.lyrics': '作詞',
  'albumDetail.credit.role.other': '其他貢獻',
  'albumDetail.credit.role.performer': '演奏',
  'albumDetail.credit.role.production': '製作',
  'albumDetail.credit.role.vocal': '演唱與聲部',
  'albumDetail.credit.source.album': '專輯貢獻',
  'albumDetail.credit.source.label': '廠牌',
  'albumDetail.credit.source.recording': '曲目貢獻',
  'albumDetail.credit.source.work': '作品貢獻',
  'albumDetail.credit.summary.arrangement': '編曲、配器和改編相關貢獻。',
  'albumDetail.credit.summary.composer': '來自發行、錄音或作品關係的音樂創作資訊。',
  'albumDetail.credit.summary.engineering': '錄音、混音、母帶和聲音工程資訊。',
  'albumDetail.credit.summary.label': '與發行相關的廠牌和目錄資訊。',
  'albumDetail.credit.summary.lyrics': '歌詞、文字、腳本和相關寫作貢獻。',
  'albumDetail.credit.summary.other': '線上中繼資料匹配到的其他貢獻。',
  'albumDetail.credit.summary.performer': '發行或單曲錄音中的演奏與表演貢獻。',
  'albumDetail.credit.summary.production': '製作人和製作側貢獻。',
  'albumDetail.credit.summary.vocal': '主唱、客座聲音和演唱相關貢獻。',
  'albumDetail.credits.count': '{count} 位貢獻者 / 組織',
  'albumDetail.credits.entries': '{count} 條',
  'albumDetail.credits.heading': '專輯貢獻',
  'albumDetail.credits.overviewAria': '貢獻概覽',
  'albumDetail.credits.trackPrefix': '曲目：{title}',
  'albumDetail.duration.hours': '{hours} 小時 {minutes} 分鐘',
  'albumDetail.duration.minutes': '{minutes} 分鐘',
  'albumDetail.fact.format': '格式',
  'albumDetail.fact.genre': '曲風',
  'albumDetail.fact.library': '曲庫',
  'albumDetail.fact.released': '發行',
  'albumDetail.information.albumProfile': '專輯資料',
  'albumDetail.information.artistProfile': '藝術家資料',
  'albumDetail.information.atGlance': '概覽',
  'albumDetail.information.externalLinks': '外部連結',
  'albumDetail.information.overviewAria': '專輯與藝術家概覽',
  'albumDetail.label.album': '專輯',
  'albumDetail.online.emptyDescription': 'MusicBrainz 和 Wikipedia 沒有回傳足夠可靠的專輯匹配資料。',
  'albumDetail.online.emptyTitle': '沒有找到可靠的線上資訊',
  'albumDetail.online.match': 'MusicBrainz 匹配',
  'albumDetail.online.noSource': '沒有匹配來源',
  'albumDetail.online.possibleMatch': '可能的 MusicBrainz 匹配',
  'albumDetail.online.reading': '正在讀取線上專輯資訊...',
  'albumDetail.online.sources': '線上來源',
  'albumDetail.online.unavailable': '線上資訊不可用',
  'albumDetail.ratings.count': '{count} 個評分',
  'albumDetail.ratings.overviewAria': '外部專輯評分',
  'albumDetail.releases.count': '{count} 個發行版本',
  'albumDetail.releases.current': '目前匹配',
  'albumDetail.releases.currentHint': '標記目前本地專輯匹配到的 MusicBrainz 版本',
  'albumDetail.releases.heading': '版本 / 發行',
  'albumDetail.releases.overviewAria': '專輯發行版本概覽',
  'albumDetail.related.aria': '{artist} 在曲庫中的專輯',
  'albumDetail.related.heading': '我的曲庫',
  'albumDetail.related.loading': '正在載入專輯',
  'albumDetail.related.thisAlbum': '目前專輯',
  'albumDetail.sources.barcode': '條碼',
  'albumDetail.sources.catalogNumber': '目錄號',
  'albumDetail.sources.copyright': '版權資訊',
  'albumDetail.sources.kind.database': '資料庫',
  'albumDetail.sources.kind.official': '官方',
  'albumDetail.sources.kind.other': '網頁',
  'albumDetail.sources.kind.reference': '資料',
  'albumDetail.sources.kind.streaming': '串流',
  'albumDetail.sources.labels': '廠牌 / 目錄',
  'albumDetail.sources.linksAria': '專輯外部來源連結',
  'albumDetail.sources.releaseAria': '目前匹配發行資訊',
  'albumDetail.sources.releaseDetails': '目前發行',
  'albumDetail.status.addedToQueue': '已加入佇列 {count} 首。',
  'albumDetail.status.copiedCover': '已複製封面原圖',
  'albumDetail.status.libraryReady': '{value} 就緒',
  'albumDetail.status.readingSignal': '正在讀取訊號',
  'albumDetail.status.unknownGenre': '未知曲風',
  'albumDetail.status.unknownLength': '未知時長',
  'albumDetail.status.unknownYear': '未知年份',
  'albumDetail.tab.credits': '貢獻',
  'albumDetail.tab.information': '資訊',
  'albumDetail.tab.releases': '版本',
  'albumDetail.tab.sources': '來源',
  'albumDetail.tab.tracks': '曲目',
  'albumDetail.texture.discs': '{count} 張碟',
  'albumDetail.tracks.action.like': '喜歡 {title}',
  'albumDetail.tracks.action.likeTitle': '喜歡',
  'albumDetail.tracks.action.unlike': '取消喜歡 {title}',
  'albumDetail.tracks.action.unlikeTitle': '取消喜歡',
  'albumDetail.tracks.aria': '專輯曲目',
  'albumDetail.tracks.column.signal': '訊號',
  'albumDetail.tracks.column.time': '時長',
  'albumDetail.tracks.column.title': '標題',
  'albumDetail.tracks.confirm.delete': '刪除音樂檔案？\n{title}',
  'albumDetail.tracks.empty': '這張專輯沒有曲目。',
  'albumDetail.tracks.error.actionUnavailable': '這個曲目操作暫不可用。',
  'albumDetail.tracks.error.desktopBridgeActions': '桌面橋接不可用。請在 ECHO Next 桌面版中使用檔案操作。',
  'albumDetail.tracks.error.desktopBridgeEdit': '桌面橋接不可用。請在 ECHO Next 桌面版中編輯內嵌標籤。',
  'albumDetail.tracks.error.desktopBridgeRead': '桌面橋接不可用。請在 ECHO Next 桌面版中讀取專輯曲目。',
  'albumDetail.tracks.error.noCoverSaved': '沒有儲存任何封面。',
  'albumDetail.tracks.error.noCoverToCopy': '這首歌沒有可複製的封面。',
  'albumDetail.tracks.error.remoteFileAction': '遠端曲目暫不支援本機檔案操作。',
  'albumDetail.tracks.formatAria': '曲目格式',
  'albumDetail.tracks.loadMore': '載入更多',
  'albumDetail.tracks.loading': '載入中...',
  'albumDetail.tracks.status.addedToPlaylist': '已加入歌單：{playlist}',
  'albumDetail.tracks.status.albumNotFound': '已經在查看這張專輯：{title}',
  'albumDetail.tracks.status.notInQueue': '佇列中沒有這首歌：{title}',
  'albumDetail.tracks.status.reloadedTags': '已從內嵌標籤重新載入：{title}',
  'albumDetail.tracks.status.removedFromQueue': '已從佇列移除：{title}',
  'albumDetail.tracks.summaryAria': '曲目摘要',
  'library.albums.card.tracks': '{count} 首歌',
  'library.albums.confirm.deleteAlbumFiles': '刪除專輯檔案？\n{title}\n\n這會把 {count} 首歌曲移到系統回收站，並從媒體庫移除。',
  'library.albums.error.coverNotSaved': '沒有儲存專輯封面。',
  'library.albums.error.desktopBridge': '桌面橋接不可用。請在 ECHO Next 桌面版中讀取專輯。',
  'library.albums.error.noCopyableCover': '這張專輯沒有可複製的封面。',
  'library.albums.error.noPlayableTracks': '這張專輯沒有可播放的歌曲。',
  'library.albums.error.remoteEditUnsupported': '遠端專輯暫不支援編輯標籤或刪除伺服器檔案。',
  'library.albums.listAria': '專輯列表',
  'library.albums.loading': '正在載入專輯...',
  'library.albums.searchPlaceholder': '搜尋專輯 / 藝術家',
  'library.albums.sort.aria': '專輯排序',
  'library.albums.sort.artist': '藝術家',
  'library.albums.sort.titleAsc': '標題 A-Z',
  'library.albums.sort.titleDesc': '標題 Z-A',
  'library.albums.title': '專輯',
  'libraryDiagnostics.lab.description': '這些功能用於開發測試即時媒體庫行為。預設關閉，不會影響一般使用者。請只在測試分支或測試曲庫中使用。',
  'library.artists.error.desktopBridge': '桌面橋接不可用。請在 ECHO Next 桌面版中讀取藝術家。',
  'library.artists.avatarPriority': '頭像優先',
  'library.artists.listAria': '藝術家列表',
  'library.artists.loading': '正在載入藝術家...',
  'library.artists.meta.albums': '{count} 張專輯',
  'library.artists.meta.noTracks': '暫無歌曲',
  'library.artists.meta.tracks': '{count} 首歌',
  'library.artists.searchPlaceholder': '搜尋藝術家',
  'library.artists.sort.aria': '藝術家排序',
  'library.artists.sort.frequent': '歌曲最多',
  'library.artists.sort.nameAsc': '名稱 A-Z',
  'library.artists.sort.nameDesc': '名稱 Z-A',
  'library.artists.title': '藝術家',
  'artistDetail.action.addToQueue': '加入佇列',
  'artistDetail.action.back': '藝術家',
  'artistDetail.action.playArtist': '播放藝術家',
  'artistDetail.action.readingArtist': '正在讀取',
  'artistDetail.action.refreshInfo': '重新整理資訊',
  'artistDetail.action.shuffle': '隨機播放',
  'artistDetail.albums.aria': '{artist} 的專輯',
  'artistDetail.albums.count': '{count} 張專輯',
  'artistDetail.albums.empty': '這位藝術家尚未歸檔專輯。',
  'artistDetail.albums.error.desktopBridge': '桌面橋接不可用。請在 ECHO Next 桌面版中讀取藝術家專輯。',
  'artistDetail.albums.heading': '{artist} 的專輯',
  'artistDetail.albums.loadedCount': '已載入 {loaded}/{total} 張專輯',
  'artistDetail.aroundWeb.aria': '藝術家官網和社群媒體',
  'artistDetail.aroundWeb.heading': 'Around the web',
  'artistDetail.aria.details': '{artist} 藝術家詳情',
  'artistDetail.aria.events': '藝術家演出',
  'artistDetail.aria.facts': '藝術家資料',
  'artistDetail.aria.metadata': '藝術家中繼資料',
  'artistDetail.aria.onlineSources': '線上藝術家來源',
  'artistDetail.aria.overview': '藝術家概覽',
  'artistDetail.aria.relationshipMap': '藝術家關係圖',
  'artistDetail.aria.sections': '{artist} 詳情分區',
  'artistDetail.duration.hours': '已載入 {hours} 小時 {minutes} 分鐘',
  'artistDetail.duration.minutes': '已載入 {minutes} 分鐘',
  'artistDetail.duration.reading': '正在讀取時長',
  'artistDetail.empty.relationships': '暫未找到本地一跳關係。',
  'artistDetail.error.desktopBridgeRead': '桌面橋接不可用。請在 ECHO Next 桌面版中讀取這位藝術家。',
  'artistDetail.events.configureProviders': '演出資訊需要配置 Bandsintown、Ticketmaster 或 SeatGeek 金鑰；未配置時不會讀取真實演出資料。',
  'artistDetail.events.collapse': '收起',
  'artistDetail.events.collapsedHint': '已找到 {count} 場演出，展開後查看日期、場館和票務入口。',
  'artistDetail.events.count': '{count} 場演出',
  'artistDetail.events.expand': '展開',
  'artistDetail.events.noConcerts': '暫未匹配到近期演出。',
  'artistDetail.events.noConcertsRegion': '暫未在 {region} 匹配到近期演出。',
  'artistDetail.events.providerKeysRequired': '需要配置來源金鑰',
  'artistDetail.events.venuePending': '場地待公布',
  'artistDetail.fact.albums': '專輯',
  'artistDetail.fact.loaded': '已載入',
  'artistDetail.fact.sources': '來源',
  'artistDetail.fact.tracks': '歌曲',
  'artistDetail.label.artist': '藝術家',
  'artistDetail.label.overview': '概覽',
  'artistDetail.meta.albums': '{count} 張專輯',
  'artistDetail.meta.loadedTracks': '已載入 {loaded}/{total}',
  'artistDetail.meta.tracks': '{count} 首歌',
  'artistDetail.missing.description': '返回藝術家頁並重新整理曲庫，即可查看最新目錄。',
  'artistDetail.missing.title': '藝術家不存在或已從曲庫移除。',
  'artistDetail.overview.about': '關於 {artist}',
  'artistDetail.overview.bioFallback': '來自你的本地曲庫。線上藝術家資訊會在背景輕量讀取。',
  'artistDetail.relation.bpm': 'BPM',
  'artistDetail.relation.collaboration': '合作',
  'artistDetail.relation.evidence': '{label} / {evidence}',
  'artistDetail.relation.genre': '流派',
  'artistDetail.relation.history': '播放歷史',
  'artistDetail.relation.link': '連結',
  'artistDetail.relation.local': '本地曲庫訊號',
  'artistDetail.relation.member': '成員',
  'artistDetail.relation.sameAlbum': '同專輯',
  'artistDetail.relation.similar': '相似',
  'artistDetail.section.concertInfo': '演出資訊',
  'artistDetail.section.events': '演出',
  'artistDetail.section.localNetwork': '本地網路',
  'artistDetail.section.relationshipMap': '關係圖',
  'artistDetail.status.collectedLocally': '本地收藏',
  'artistDetail.status.linkedArtists': '{count} 位關聯藝術家',
  'artistDetail.status.loadingSignals': '正在讀取本地訊號',
  'artistDetail.status.localLibrary': '本地曲庫',
  'artistDetail.status.readingRelationships': '正在讀取藝術家關係...',
  'artistDetail.status.readySoon': '即將就緒',
  'artistDetail.tab.albums': '專輯',
  'artistDetail.tab.overview': '概覽',
  'artistDetail.tab.songs': '歌曲',
  'artistDetail.tracks.action.addToQueueAria': '將 {title} 加入佇列',
  'artistDetail.tracks.action.more': '更多',
  'artistDetail.tracks.action.moreAria': '{title} 的更多操作',
  'artistDetail.tracks.action.playNext': '下一首播放',
  'artistDetail.tracks.action.playNextAria': '下一首播放 {title}',
  'artistDetail.tracks.aria': '{artist} 的歌曲',
  'artistDetail.tracks.column.actions': '操作',
  'artistDetail.tracks.column.album': '專輯',
  'artistDetail.tracks.column.signal': '訊號',
  'artistDetail.tracks.column.time': '時長',
  'artistDetail.tracks.column.title': '標題',
  'artistDetail.tracks.confirm.delete': '刪除這個音樂檔案？\n{title}',
  'artistDetail.tracks.empty': '這位藝術家尚未歸檔歌曲。',
  'artistDetail.tracks.error.actionUnavailable': '這個歌曲操作暫不可用。',
  'artistDetail.tracks.error.desktopBridgeActions': '桌面橋接不可用。請在 ECHO Next 桌面版中使用檔案操作。',
  'artistDetail.tracks.error.desktopBridgeEdit': '桌面橋接不可用。請在 ECHO Next 桌面版中編輯內嵌標籤。',
  'artistDetail.tracks.error.desktopBridgeRead': '桌面橋接不可用。請在 ECHO Next 桌面版中讀取藝術家歌曲。',
  'artistDetail.tracks.expandAll': '全部展開',
  'artistDetail.tracks.error.noCoverSaved': '沒有儲存任何封面圖。',
  'artistDetail.tracks.error.noCoverToCopy': '這首歌沒有可複製的封面圖。',
  'artistDetail.tracks.error.remoteFileAction': '遠端歌曲暫不支援本地檔案操作。',
  'artistDetail.tracks.formatAria': '歌曲格式',
  'artistDetail.tracks.heading': '{artist} 的歌曲',
  'artistDetail.tracks.loadedCount': '已載入 {loaded}/{total} 首歌',
  'artistDetail.tracks.loading': '正在載入歌曲...',
  'artistDetail.tracks.loadingTrack': '正在載入歌曲',
  'artistDetail.tracks.status.addedToPlaylist': '已加入歌單：{playlist}',
  'artistDetail.tracks.status.albumNotFound': '此藝術家視圖中找不到專輯：{album}',
  'artistDetail.tracks.status.notInQueue': '播放佇列中沒有這首歌：{title}',
  'artistDetail.tracks.status.reloadedTags': '已從內嵌標籤重新載入：{title}',
  'artistDetail.tracks.status.removedFromQueue': '已從播放佇列移除：{title}',
  'artistDetail.tracks.unknownAlbum': '未知專輯',
  'library.count.total': '共 {count} 個',
  'library.sort.createdAsc': '建立最早',
  'library.sort.createdDesc': '建立最新',
  'library.sort.default': '預設',
  'library.sort.durationAsc': '時長最短',
  'library.sort.durationDesc': '時長最長',
  'library.sort.fileModifiedAsc': '檔案修改最早',
  'library.sort.fileModifiedDesc': '檔案修改最新',
  'library.sort.random': '隨機',
  'library.sort.recent': '最近',
  'library.source.aria': '媒體庫來源',
  'library.source.local': '本機',
  'library.source.allRemote': '全部網路硬碟來源',
  'library.source.remote': '網路硬碟',
  'library.trackRow.action.addToPlaylist': '加入歌單',
  'library.trackRow.action.addToPlaylistLabel': '加入歌單 {title}',
  'library.trackRow.action.addToQueue': '加入佇列',
  'library.trackRow.action.addToQueueLabel': '加入佇列 {title}',
  'library.trackRow.action.download': '下載',
  'library.trackRow.action.downloadLabel': '下載 {title}',
  'library.trackRow.action.downloading': '下載中 {percent}%',
  'library.trackRow.action.downloadingLabel': '正在下載 {title} {percent}%',
  'library.trackRow.action.more': '更多',
  'library.trackRow.action.moreLabel': '更多 {title}',
  'library.trackRow.actions': '{title} 操作',
  'library.trackRow.audioSpecifications': '音訊規格',
  'library.trackRow.duplicateVersions.count': '有 {count} 個版本',
  'library.trackRow.duplicateVersions.title': '查看重複歌曲版本',
  'library.trackRow.openAlbum': '打開專輯：{album}',
  'library.trackRow.openArtist': '打開演出者：{artist}',
  'library.trackRow.status.playing': '播放中',
  'library.trackRow.status.unavailable': '不可用',
  'audioDrawer.action.close': '關閉音訊設定',
  'audioDrawer.action.copiedDiagnostics': '已複製播放診斷資訊',
  'audioDrawer.action.copyDiagnostics': '複製播放診斷資訊',
  'audioDrawer.action.hideDevice': '隱藏裝置',
  'audioDrawer.action.openAsioPanel': '開啟 ASIO 面板',
  'audioDrawer.action.resetEngine': '重置音訊引擎',
  'audioDrawer.action.resetEngineBusy': '正在重置音訊引擎',
  'audioDrawer.action.resetEngineDone': '音訊引擎已重置',
  'audioDrawer.action.restore': '復原',
  'audioDrawer.asioLatency.description': '根據目前開啟的緩衝估算輸出端會多等多久才播放。數值越低越即時，數值越高越穩、越不容易爆音。',
  'audioDrawer.asioLatency.recommended': '建議延遲',
  'audioDrawer.asioLatency.status': '要求 {requested} frames / 已開啟 {opened} frames',
  'audioDrawer.asioLatency.value': '{value} ms',
  'audioDrawer.asioRoutes.title': 'ASIO 輸出通道',
  'audioDrawer.badge.bitPerfectReady': 'Bit-perfect 就緒',
  'audioDrawer.badge.dspActive': 'DSP 啟用',
  'audioDrawer.badge.juceFallback': 'JUCE 已降級',
  'audioDrawer.badge.juceOutput': 'JUCE 輸出',
  'audioDrawer.badge.resampling': '重取樣',
  'audioDrawer.badge.soxrResampler': 'SOXR',
  'audioDrawer.badge.speedUp': '加速',
  'audioDrawer.buffer.asio': 'ASIO 緩衝',
  'audioDrawer.buffer.auto': '自動',
  'audioDrawer.buffer.collapsedDescription': '預設收合；點開可調整延遲檔位與 ASIO 緩衝。',
  'audioDrawer.buffer.default': '預設',
  'audioDrawer.buffer.latencyProfile': '延遲檔位',
  'audioDrawer.buffer.low': '低',
  'audioDrawer.buffer.profileDefault': '跟隨檔位預設',
  'audioDrawer.buffer.safer': '更穩',
  'audioDrawer.buffer.stable': '穩定',
  'audioDrawer.buffer.title': '緩衝設定',
  'audioDrawer.buffer.ultraLow': '超低延遲',
  'audioDrawer.device.asioDriver': 'ASIO 驅動',
  'audioDrawer.device.lowLatency': '低延遲',
  'audioDrawer.device.selected': '已選取',
  'audioDrawer.device.systemAudio': 'Windows直出',
  'audioDrawer.device.systemAudioDescription': '預設 Windows 音訊路徑，適合普通耳機、藍牙、電腦喇叭',
  'audioDrawer.device.systemDefault': '系統預設',
  'audioDrawer.device.systemDefaultOutput': '系統預設輸出',
  'audioDrawer.device.systemOutput': '系統輸出',
  'audioDrawer.device.systemSelectedRoute': '系統選取路徑',
  'audioDrawer.empty.asioDevices': '找不到 ASIO 輸出裝置。',
  'audioDrawer.empty.hiddenDevices': '沒有隱藏裝置。',
  'audioDrawer.empty.systemDevices': '找不到系統輸出裝置。',
  'audioDrawer.error.desktopBridgeUnavailable': '桌面橋接不可用',
  'audioDrawer.meter.direct': '直通',
  'audioDrawer.meter.chain': '鏈路',
  'audioDrawer.meter.mode': '模式',
  'audioDrawer.meter.output': '輸出',
  'audioDrawer.meter.rate': '取樣率',
  'audioDrawer.meter.resample': '重取樣',
  'audioDrawer.meter.source': '音源',
  'audioDrawer.meter.latency': '延遲',
  'audioDrawer.guard.asioUnavailable.description': '預設關閉。遇到 No device found 後會短暫跳過同一個 ASIO 裝置，並改用安全的共享輸出。',
  'audioDrawer.guard.asioUnavailable.title': 'ASIO 不可用保護',
  'audioDrawer.guard.exclusiveInstability.description': '預設關閉。WASAPI 獨占持續 underrun 或裝置變得不穩定時，開啟後會從目前位置切到安全共享輸出。',
  'audioDrawer.guard.exclusiveInstability.title': '獨占不穩定自動切共享',
  'audioDrawer.guard.soxrFallback.description': '預設開啟。如果共享 SOXR 重取樣在 PCM 開始前不可用，會退回到 FFmpeg 預設重取樣。',
  'audioDrawer.guard.soxrFallback.title': 'SOXR 退回保護',
  'audioDrawer.latency.balanced': '均衡',
  'audioDrawer.latency.balancedDetail': '2048 frames',
  'audioDrawer.latency.lowLatency': '低延遲',
  'audioDrawer.latency.lowLatencyDetail': '1024 frames / 不穩升均衡',
  'audioDrawer.latency.stable': '穩定',
  'audioDrawer.latency.stableDetail': '8192 frames',
  'audioDrawer.mode.exclusive': '獨佔',
  'audioDrawer.mode.exclusiveCandidate': '獨佔候選',
  'audioDrawer.mode.directSound': 'DirectSound 相容',
  'audioDrawer.mode.shared': '共享',
  'audioDrawer.note.asio': '低延遲專業音訊介面，需要驅動支援。',
  'audioDrawer.note.currentOutput': '這裡顯示現在真正使用的輸出路徑；共享適合日常，ASIO 和 WASAPI 獨佔會以金色標出。',
  'audioDrawer.note.engine': '這裡快速查看輸出裝置、模式、取樣率、EQ 和重取樣狀態。',
  'audioDrawer.note.juceOutput': '預設關閉。FFmpeg 相容路徑作為預設輸出；需要時可手動開啟 JUCE 輸出，失敗會自動退回。',
  'audioDrawer.note.juceDecode': '預設關閉。開啟後，本機 WAV/FLAC/MP3 在不需重取樣時使用常駐原生解碼；MP3 走 Windows Media，失敗會自動退回 FFmpeg。',
  'audioDrawer.note.dsdDop': '預設關閉。本機 DSF 在獨占或 ASIO 下嘗試 DoP 直出；失敗會自動退回 FFmpeg PCM，最終以 DAC 顯示為準。',
  'audioDrawer.note.asioNativeDsd': '預設關閉。僅 ASIO + 本機 DSF + DoP 開啟且無 EQ/音量/變速/DSP 時嘗試；失敗會退回現有 DoP/PCM。',
  'audioDrawer.note.dsdAutoVolumeLock': '預設關閉。開啟後播放 DSD 時暫時鎖定 ECHO 音量為 100%，切回 PCM 後恢復到原本音量。',
  'audioDrawer.note.releaseExclusiveOnPause': '實驗功能。暫停時釋放 WASAPI 獨占，讓其他軟體暫時出聲；恢復播放會重新搶獨占，失敗時暫時降到共享。',
  'audioDrawer.option.juceOutput': 'JUCE 主輸出',
  'audioDrawer.option.juceDecode': '常駐原生解碼',
  'audioDrawer.option.dsdDop': 'DSD DoP 直出試驗',
  'audioDrawer.option.asioNativeDsd': 'ASIO 原生 DSD 實驗',
  'audioDrawer.option.dsdAutoVolumeLock': '播放 DSD 時自動鎖定音量',
  'audioDrawer.option.releaseExclusiveOnPause': '暫停釋放獨占實驗',
  'audioDrawer.option.active': '開啟',
  'audioDrawer.option.set': '設定',
  'audioDrawer.option.automix': '啟用 Automix',
  'audioDrawer.option.automixActive': '目前播放已進入 Automix 預混路徑。',
  'audioDrawer.option.automixDescription': '預設關閉。開啟後會在佇列連續播放時自動把目前歌曲尾段與下一首重疊淡入淡出。',
  'audioDrawer.option.rememberOutput': '儲存輸出設定',
  'audioDrawer.option.rememberOutputDescription': '下次啟動時復原所選輸出裝置、輸出模式與緩衝等參數。',
  'audioDrawer.option.fixedVolume': '固定音量',
  'audioDrawer.option.fixedVolumeDescription': '開啟後會將 ECHO 音量控制鎖定為 100%；ReplayGain 仍會獨立生效。',
  'audioDrawer.option.lowLoadPlaybackMode': '低負載播放模式',
  'audioDrawer.option.lowLoadPlaybackModeDescription': '開啟後播放期間停用即時頻譜、頻繁播放頁刷新、ReplayGain/BPM 重新分析、逐字歌詞高頻刷新、自動歌詞深搜、封面/藝人圖抓取和 MV 預載。',
  'audioDrawer.option.lowLoadPlaybackEnhancements': '低負載增強保護',
  'audioDrawer.option.lowLoadPlaybackEnhancementsDescription': '預設關閉。僅在低負載播放模式開啟時生效，會進一步降低輪詢、桌面歌詞、診斷、後台曲庫任務、串流預熱和 MV 自動搜尋負載。',
  'audioDrawer.option.showAsioPanelSettings': '是否顯示 ASIO 面板設定',
  'audioDrawer.option.showAsioPanelSettingsDescription': '預設關閉。開啟後才會在 ASIO 裝置下顯示「開啟 ASIO 面板」按鈕。',
  'audioDrawer.option.alsaShared': 'ALSA',
  'audioDrawer.option.alsaSharedDescription': '透過 Linux ALSA 裝置輸出。',
  'audioDrawer.option.directSound': 'DirectSound 相容',
  'audioDrawer.option.directSoundDescription': '手動相容模式，延遲較大；只在 WASAPI 播放異常時嘗試。',
  'audioDrawer.option.linuxAutoShared': '自動',
  'audioDrawer.option.linuxAutoSharedDescription': '優先使用 ALSA，並尊重系統的 PipeWire/ALSA 相容層設定。',
  'audioDrawer.option.sharedBackend': '共享後端',
  'audioDrawer.option.wasapiShared': 'WASAPI Shared',
  'audioDrawer.option.wasapiSharedDescription': '日常 Windows 共享輸出路徑。',
  'audioDrawer.option.wasapiExclusive': 'WASAPI 獨佔模式',
  'audioDrawer.option.wasapiExclusiveDescription': '共享是日常 Windows 輸出路徑。獨佔會要求同一裝置並略過共享混音器，只建議在確認 DAC/音效卡與驅動穩定時使用；Realtek 等板載驅動相容性較差，可能導致無聲、卡頓或切換失敗。',
  'audioDrawer.section.advancedOutput': '進階音訊引擎',
  'audioDrawer.section.advancedOutputDescription': '適合外接音效卡、WASAPI Exclusive、ASIO 和 HiFi 調試',
  'audioDrawer.section.automix': 'Automix',
  'audioDrawer.section.asioDevices': 'ASIO 輸出裝置',
  'audioDrawer.section.currentOutput': '目前輸出',
  'audioDrawer.section.hiddenDevices': '隱藏裝置',
  'audioDrawer.section.systemDevices': '推薦輸出',
  'audioDrawer.signal.balanceDsp': '平衡 DSP',
  'audioDrawer.signal.bitPerfect': 'Bit-perfect',
  'audioDrawer.signal.dspOn': 'DSP 開啟',
  'audioDrawer.signal.eqOff': 'EQ 關閉',
  'audioDrawer.signal.eqOn': 'EQ 開啟',
  'audioDrawer.signal.asioSdkOutput': 'ASIO SDK 輸出',
  'audioDrawer.signal.ffmpegDecode': 'FFmpeg 解碼',
  'audioDrawer.signal.dsdDop': 'DSF bitstream -> DoP',
  'audioDrawer.signal.dsdDopFallback': 'DSD DoP 已降級',
  'audioDrawer.signal.dsdDopStandby': 'DoP 未適用',
  'audioDrawer.signal.juceDecode': 'JUCE 解碼',
  'audioDrawer.signal.juceDecodeFallback': 'JUCE 解碼已降級',
  'audioDrawer.signal.juceDecodeStandby': 'JUCE 解碼未適用',
  'audioDrawer.signal.nativeRate': '原生取樣率',
  'audioDrawer.signal.noActiveSource': '沒有作用中的音源',
  'audioDrawer.signal.pending': '等待中',
  'audioDrawer.signal.processed': '已處理',
  'audioDrawer.signal.sharedMixer': '共享混音器',
  'audioDrawer.signal.standardPath': '標準路徑',
  'audioDrawer.status.noTrack': '沒有曲目',
  'audioDrawer.status.ratePending': '取樣率待定',
  'audioDrawer.status.sampleRatePending': '取樣率待定',
  'audioDrawer.title': '音訊設定',
  'audioDrawer.warning.highOutputSampleRate': '目前音訊裝置取樣率過高，可能導致播放速度異常，建議改為 48 kHz。',
  'audioProfessional.action.hideDetails': '收起專業詳情',
  'audioProfessional.action.refresh': '重新整理狀態',
  'audioProfessional.action.showDetails': '展開專業詳情',
  'audioProfessional.badge.bitPerfect': 'Bit-perfect',
  'audioProfessional.badge.dsp': 'DSP active',
  'audioProfessional.badge.protect': 'Protect',
  'audioProfessional.badge.replayGain': 'ReplayGain',
  'audioProfessional.badge.resampling': '重取樣',
  'audioProfessional.badge.sampleMismatch': '取樣率不符',
  'audioProfessional.badge.warning': '裝置異常/警告',
  'audioProfessional.issue.reason': '異常原因',
  'audioProfessional.issue.audioLevelClipped': '即時電平偵測到削波，請降低前級增益或關閉增益類 DSP。',
  'audioProfessional.issue.audioLevelClippingRisk': '即時電平接近 0 dBFS，有削波風險。',
  'audioProfessional.issue.dspClippingRisk': 'DSP 鏈路輸出有削波風險，Protect limiter 已進入待命監控。',
  'audioProfessional.issue.dspLimiterProtecting': 'Protect limiter 正在保護輸出，表示 DSP 後級訊號已超過安全閾值。',
  'audioProfessional.issue.roomCorrectionBitPerfectDisabled': '房間校正會關閉 bit-perfect 輸出。',
  'audioProfessional.issue.roomCorrectionClippingRisk': '房間校正輸出有削波風險，請降低 FIR Trim 或啟用 Auto Gain。',
  'audioProfessional.issue.sharedMixRateTooHigh': 'Windows 共享取樣率過高：裝置是 {deviceRate}，ECHO 目前輸出 {decoderRate} PCM，可能導致變速。建議把 Windows 預設格式改到 48 kHz。',
  'audioProfessional.issue.windowsDefaultFormatUnusual': 'Windows 預設格式設定偏高：目前是 {deviceRate}。ECHO 只會提醒，不會修改系統設定；建議改到 48 kHz。',
  'audioProfessional.group.directDsp': '直通與 DSP',
  'audioProfessional.group.playbackChain': '播放鏈路',
  'audioProfessional.group.sampleRate': '取樣率鏈路',
  'audioProfessional.group.stability': '穩定性',
  'audioProfessional.signal.decode': '解碼',
  'audioProfessional.signal.dsp': 'DSP',
  'audioProfessional.signal.fir': 'FIR',
  'audioProfessional.signal.headroom': '餘量',
  'audioProfessional.signal.native': '原生',
  'audioProfessional.signal.output': '輸出',
  'audioProfessional.signal.source': '來源',  'audioProfessional.row.actualBuffer': '實際 buffer',
  'audioProfessional.row.actualDeviceSampleRate': '實際裝置取樣率',
  'audioProfessional.row.bitDepth': '位元深度',
  'audioProfessional.row.bitPerfect': 'Bit-perfect',
  'audioProfessional.row.bitrate': '位元率',
  'audioProfessional.row.buffered': '目前緩衝',
  'audioProfessional.row.channelBalance': '聲道平衡',
  'audioProfessional.row.channels': '聲道',
  'audioProfessional.row.clippingProtection': '削波保護',
  'audioProfessional.row.codec': '格式',
  'audioProfessional.row.decodeBackend': '解碼後端',
  'audioProfessional.row.decoderOutputSampleRate': '解碼輸出',
  'audioProfessional.row.deviceBuffer': '裝置 buffer',
  'audioProfessional.row.eq': 'EQ',
  'audioProfessional.row.error': '錯誤',
  'audioProfessional.row.fileSampleRate': '音源取樣率',
  'audioProfessional.row.latencyProfile': '延遲檔位',
  'audioProfessional.row.outputBackend': '輸出後端',
  'audioProfessional.row.outputDevice': '輸出裝置',
  'audioProfessional.row.outputLatency': '輸出延遲',
  'audioProfessional.row.outputMode': '輸出模式',
  'audioProfessional.row.replayGain': 'ReplayGain',
  'audioProfessional.row.protectLimiter': 'Protect limiter',
  'audioProfessional.row.roomCorrection': '房間校正',
  'audioProfessional.row.requestedBuffer': '要求 buffer',
  'audioProfessional.row.requestedOutputSampleRate': '要求輸出',
  'audioProfessional.row.resampler': '重取樣器',
  'audioProfessional.row.resampling': '重取樣',
  'audioProfessional.row.sampleRateMismatch': '取樣率不符',
  'audioProfessional.row.signalPath': '訊號路徑',
  'audioProfessional.row.sharedDeviceSampleRate': '共享裝置取樣率',
  'audioProfessional.row.sharedStability': '共享穩定檔',
  'audioProfessional.row.soxr': 'SOXR',
  'audioProfessional.row.state': '狀態',
  'audioProfessional.row.underrun': 'Underrun',
  'audioProfessional.row.warnings': '警告',
  'audioProfessional.summary.pending': '等待音訊狀態',
  'audioProfessional.title': '專業播放狀態',
  'audioProfessional.value.disabled': '關閉',
  'audioProfessional.value.dspPath': 'DSP 路徑：{modules}',
  'audioProfessional.value.enabled': '開啟',
  'audioProfessional.value.nativePath': '原生直通',
  'audioProfessional.value.no': '否',
  'audioProfessional.value.pending': '待確認',
  'audioProfessional.value.ready': '可直通',
  'audioProfessional.value.sharedMixer': '共享混音',
  'audioProfessional.value.systemDefault': '系統預設輸出',
  'audioProfessional.value.unknown': 'n/a',
  'audioProfessional.value.yes': '是',
  'audioDrawer.todo.outputControls': '目標取樣率與緩衝控制',
  'audioDrawer.todo.outputControlsDescription': 'TODO：等 DeviceService 暴露安全控制後接入真實音訊設定。',
  'audioDrawer.troubleshooting.description': '如果聲音卡住或裝置列表不正常，點這裡。軟重啟不會影響其他應用程式。',
  'audioDrawer.troubleshooting.hardAction': '重啟 Windows 音訊服務',
  'audioDrawer.troubleshooting.hardBusy': '正在重啟 Windows 音訊服務',
  'audioDrawer.troubleshooting.hardConfirm': '這會中斷所有應用程式的聲音（Chrome、遊戲、通話），並需要系統管理員權限。是否繼續？',
  'audioDrawer.troubleshooting.hardDone': 'Windows 音訊服務已恢復，你可以重新開始播放',
  'audioDrawer.troubleshooting.softAction': '重啟音訊引擎',
  'audioDrawer.troubleshooting.softBusy': '正在重啟音訊引擎',
  'audioDrawer.troubleshooting.softDone': '音訊引擎已重啟，你可以重新開始播放',
  'audioDrawer.troubleshooting.title': '音訊故障排除',
  'trackMenu.action.addToPlaylist': '加入播放清單...',
  'trackMenu.action.playNext': '下一首播放',
  'trackMenu.action.addToQueue': '加入佇列',
  'trackMenu.action.like': '喜歡',
  'trackMenu.action.unlike': '取消喜歡',
  'trackMenu.action.removeFromQueue': '從播放佇列移除',
  'trackMenu.action.removeFromPlaylist': '從目前播放清單移除',
  'trackMenu.action.openOsuTiming': 'osu! Timing',
  'trackMenu.action.editTags': '編輯標籤',
  'trackMenu.action.reloadEmbeddedTags': '重新載入嵌入標籤',
  'trackMenu.action.clearLyricsCache': '清理歌詞快取',
  'trackMenu.action.goToAlbum': '定位到專輯',
  'trackMenu.action.showInFolder': '在資料夾中顯示',
  'trackMenu.action.copyPath': '複製檔案路徑',
  'trackMenu.action.openSystem': '使用系統預設應用程式打開',
  'trackMenu.action.copyNameArtist': '複製歌名與演出者',
  'trackMenu.action.copyCover': '複製歌曲卡片圖片',
  'trackMenu.action.saveCover': '儲存歌曲卡片圖片',
  'trackMenu.action.deleteSong': '刪除歌曲',
  'folders.action.addScan': '加入並掃描',
  'folders.action.browse': '瀏覽',
  'folders.action.cancel': '取消',
  'folders.action.open': '打開',
  'folders.action.play': '播放',
  'folders.action.queue': '加入佇列',
  'folders.action.random': '隨機',
  'folders.action.refresh': '重新整理資料夾',
  'folders.action.remove': '移除',
  'folders.action.scan': '掃描',
  'folders.confirm.deleteTrack': '刪除這個音樂檔？\n{title}',
  'folders.confirm.removeRoot': '從曲庫索引中移除「{name}」？音樂檔會保留在磁碟上。',
  'folders.count.tracks': '{count} 首',
  'folders.detail.importHint': '匯入音樂資料夾後，可以依路徑瀏覽曲庫。',
  'folders.detail.libraryFolders': '曲庫資料夾',
  'folders.detail.root': '根目錄',
  'folders.detail.selectFolder': '選擇資料夾',
  'folders.detail.subfolder': '子資料夾',
  'folders.duration.hours': '{count} 小時',
  'folders.duration.hoursMinutes': '{hours} 小時 {minutes} 分鐘',
  'folders.duration.minutes': '{count} 分鐘',
  'folders.empty.noScan': '這個根目錄還沒有執行過掃描。',
  'folders.empty.roots': '還沒有曲庫資料夾。',
  'folders.error.actionFailed': '資料夾操作失敗。',
  'folders.error.desktopEditTags': '桌面橋接不可用。請在 ECHO Next 桌面端編輯內嵌標籤。',
  'folders.error.desktopFileActions': '桌面橋接不可用。請在 ECHO Next 桌面端使用檔案操作。',
  'folders.error.desktopImport': '桌面橋接不可用。請在 ECHO Next 桌面端匯入資料夾。',
  'folders.error.desktopManage': '桌面橋接不可用。請在 ECHO Next 桌面端管理資料夾。',
  'folders.error.noCoverSaved': '沒有儲存任何封面。',
  'folders.error.noCoverToCopy': '這首歌沒有可複製的封面。',
  'folders.error.notFolder': '選取的路徑不是資料夾。',
  'folders.error.pathMissing': '資料夾路徑不存在。',
  'folders.error.permission': 'ECHO 沒有權限存取這個資料夾。',
  'folders.error.trackActionUnavailable': '這個歌曲操作暫不可用。',
  'folders.filters.includeSubfolders': '包含子資料夾',
  'folders.filters.label': '資料夾歌曲篩選',
  'folders.filters.searchPlaceholder': '搜尋此資料夾...',
  'folders.message.addedToPlaylist': '已加入播放清單：{name}',
  'folders.message.alreadyScanning': '這個曲庫根目錄正在掃描。',
  'folders.message.folderAddedScanStarted': '資料夾已加入，掃描已在背景開始。',
  'folders.message.folderRemoved': '資料夾已從曲庫索引中移除。',
  'folders.message.loadedPartial': '已載入前 {loaded} / {total} 首，避免佔用過多記憶體。',
  'folders.message.loadedTracks': '已載入 {count} 首。',
  'folders.message.noPlayableTracks': '這個資料夾裡沒有可播放歌曲。',
  'folders.message.queuedTracks': '已加入佇列 {count} 首。',
  'folders.message.scanCancelled': '掃描已取消。',
  'folders.message.scanStarted': '掃描已開始。',
  'folders.metrics.duration': '長度',
  'folders.metrics.label': '資料夾指標',
  'folders.metrics.size': '大小',
  'folders.metrics.subfolders': '子資料夾',
  'folders.metrics.tracks': '歌曲',
  'folders.panel.addFolder': '加入資料夾',
  'folders.panel.import': '匯入',
  'folders.panel.manage': '管理',
  'folders.panel.scan': '掃描',
  'folders.panel.selectedRoot': '已選根目錄',
  'folders.panel.status': '狀態',
  'folders.phase.checkingCache': '檢查快取',
  'folders.phase.discovering': '尋找檔案',
  'folders.phase.extractingCovers': '擷取封面',
  'folders.phase.finished': '已完成',
  'folders.phase.groupingAlbums': '整理專輯',
  'folders.phase.readingMetadata': '讀取標籤',
  'folders.phase.writingDatabase': '寫入資料庫',
  'folders.prompt.choosePlaylist': '選擇播放清單編號：\n{names}',
  'folders.prompt.createPlaylist': '還沒有播放清單。輸入名稱來建立一個：',
  'folders.queueSource.recursive': '{name} 資料夾',
  'folders.scan.progress': '{processed}/{total} 個檔案，{errors} 個錯誤',
  'folders.sidebar.kicker': '曲庫',
  'folders.sidebar.title': '資料夾',
  'folders.sort.album': '專輯',
  'folders.sort.artist': '演出者',
  'folders.sort.duration': '長度',
  'folders.sort.quality': '音質',
  'folders.sort.random': '隨機',
  'folders.sort.recent': '最近更新',
  'folders.sort.title': '標題',
  'folders.status.cancelled': '已取消',
  'folders.status.completed': '完成',
  'folders.status.failed': '失敗',
  'folders.status.queued': '排隊中',
  'folders.status.running': '掃描中',
  'folders.statusLine.loadingTracks': '正在讀取資料夾歌曲...',
  'folders.statusLine.preparingQueue': '正在準備資料夾佇列...',
  'route.albums.label': '專輯',
  'route.artists.label': '演出者',
  'route.audioSettings.label': '音訊設定',
  'route.connect.description': 'DLNA / AirPlay 無線播放。',
  'route.connect.label': '連接',
  'route.dsp.description': '訊號鏈調音工作台。',
  'route.dsp.label': 'DSP',
  'connectPage.controls.aria': 'Connect 控制',
  'connectPage.controls.disconnect': '中斷連接',
  'connectPage.controls.pause': '暫停',
  'connectPage.controls.play': '播放',
  'connectPage.controls.stop': '停止',
  'connectPage.controls.volume': '投送音量',
  'connectPage.deviceState.available': '可用',
  'connectPage.deviceState.connected': '已連接',
  'connectPage.deviceState.unavailable': '離線',
  'connectPage.deviceState.unsupported': '實驗',
  'connectPage.devices.allHidden': '目前設備都已隱藏',
  'connectPage.devices.aria': '設備列表',
  'connectPage.devices.collapse': '收起區域網串流設備',
  'connectPage.devices.empty': '未發現區域網設備',
  'connectPage.devices.emptyHint': '重新整理後會在這裡顯示串流器、TV、HQPlayer 和 AirPlay 入口。',
  'connectPage.devices.expand': '展開區域網串流設備',
  'connectPage.devices.hiddenAria': '已隱藏的區域網設備',
  'connectPage.devices.hiddenTitle': '已隱藏設備',
  'connectPage.devices.kicker': 'NETWORK STREAMERS',
  'connectPage.devices.restoreAll': '全部恢復',
  'connectPage.devices.restoreHint': '可在上方恢復隱藏設備。',
  'connectPage.devices.summary': '{streamers} 台串流器 · {entries} 個入口 · 已隱藏 {hidden}',
  'connectPage.devices.title': '區域網串流',
  'connectPage.header.autoStart': '啟動時自動開啟 AirPlay / DLNA',
  'connectPage.header.description': '集中管理 DLNA / AirPlay / HQPlayer 外部播放；HQPlayer 目前以安全交接預演為主。',
  'connectPage.header.kicker': 'WIRELESS PLAYBACK',
  'connectPage.header.refresh': '重新整理設備',
  'connectPage.hqplayer.enable': '啟用 HQPlayer',
  'connectPage.hqplayer.kicker': 'EXTERNAL RENDERER',
  'connectPage.hqplayer.localDesktop': '本機 HQPlayer Desktop',
  'connectPage.hqplayer.state.available': '可連接',
  'connectPage.hqplayer.state.checking': '檢測中',
  'connectPage.hqplayer.state.disabled': '未啟用',
  'connectPage.hqplayer.state.notConfigured': '未設定連接埠',
  'connectPage.hqplayer.state.unavailable': '不可用',
  'connectPage.hqplayer.test': '檢測 HQPlayer',
  'connectPage.nowPlaying.aria': '目前投送',
  'connectPage.nowPlaying.chooseDevice': '選擇一台區域網串流器後開始投送',
  'connectPage.nowPlaying.coverReady': '封面 URL 已送出',
  'connectPage.nowPlaying.coverWaiting': '等待封面 URL',
  'connectPage.nowPlaying.dlnaPolling': '狀態輪詢約 3 秒',
  'connectPage.nowPlaying.emptyTitle': '目前沒有歌曲',
  'connectPage.nowPlaying.infoAria': '目前投送資訊',
  'connectPage.nowPlaying.infoWaiting': '等待投送資訊',
  'connectPage.nowPlaying.latency': '投送握手 {ms}ms',
  'connectPage.nowPlaying.noOutput': '未連接輸出',
  'connectPage.nowPlaying.progressAria': '投送進度',
  'connectPage.outgoing.aria': 'DLNA outgoing request log',
  'connectPage.outgoing.empty': 'No pulls yet',
  'connectPage.outgoing.note': '設備拉取封面或音訊後會顯示在這裡',
  'connectPage.outgoing.recent': '{count} recent',
  'connectPage.outgoing.title': 'DLNA Out',
  'connectPage.receiver.aria': '接收來自手機',
  'connectPage.receiver.disable': '關閉接收',
  'connectPage.receiver.discoveryHint': '開啟後手機即可發現',
  'connectPage.receiver.enable': '開啟接收',
  'connectPage.receiver.fromClient': '來自 {address}',
  'connectPage.receiver.kicker': 'RECEIVER',
  'connectPage.receiver.noClient': '未連接手機',
  'connectPage.receiver.preparing': '正在準備區域網位址',
  'connectPage.receiver.progressAria': '接收播放進度',
  'connectPage.receiver.state.disabled': '未開啟',
  'connectPage.receiver.state.idle': '等待手機',
  'connectPage.receiver.state.loading': '載入中',
  'connectPage.receiver.state.playing': '手機投送中',
  'connectPage.receiver.state.ready': '已接收媒體',
  'connectPage.receiver.stop': '停止接收播放',
  'connectPage.receiver.title': '接收來自手機',
  'connectPage.receiver.waitingTitle': '等待手機投送',
  'connectPage.stage.aria': '快速投送',
  'connectPage.state.connecting': '連接中',
  'connectPage.state.discovering': '掃描設備',
  'connectPage.state.error': '錯誤',
  'connectPage.state.idle': '待機',
  'connectPage.state.paused': '已暫停',
  'connectPage.state.playing': '投送中',
  'connectPage.state.stopped': '已停止',
  'connectPage.airplay.state.idle': '等待 iPhone',
  'connectPage.airplay.state.playing': 'AirPlay 播放中',
  'connectPage.airplay.state.starting': '啟動中',
  'connectPage.airplay.state.unavailable': '原生後端不可用',
  'connectPage.airplay.waitingTitle': '等待 iPhone 投送',
  'route.downloads.description': '下載任務佔位。',
  'route.downloads.label': '下載',
  'route.folders.label': '資料夾',
  'historyPage.action.clear': '清空歷史',
  'historyPage.action.refreshInvalid': '刷新失效歌曲',
  'historyPage.confirm.clear': '要清空播放歷史嗎？這不會刪除你的音樂檔案，也不會清空曲庫。',
  'historyPage.date.none': '暫無',
  'historyPage.duration.hoursMinutes': '{hours} 小時 {minutes} 分鐘',
  'historyPage.duration.minutes': '{count} 分鐘',
  'historyPage.empty.description': '播放一首歌後，這裡會記錄你的最近收聽。',
  'historyPage.empty.title': '還沒有播放歷史。',
  'historyPage.error.desktopBridgeRead': 'Desktop bridge unavailable. Open ECHO Next in Electron to read playback history.',
  'historyPage.filter.all': '全部',
  'historyPage.filter.completed': '只看完整播放',
  'historyPage.filter.month': '本月',
  'historyPage.filter.today': '今天',
  'historyPage.filter.week': '本週',
  'historyPage.header.kicker': '最近播放記錄',
  'historyPage.header.title': '歷史',
  'historyPage.list.aria': '播放歷史列表',
  'historyPage.list.doubleClick': '雙擊播放',
  'historyPage.list.source': '來自 {source}',
  'historyPage.list.unknownAlbum': '未知專輯',
  'historyPage.list.unknownArtist': '未知藝術家',
  'historyPage.list.unknownSource': '來源未知',
  'historyPage.loadMore': '載入更多',
  'historyPage.loading': '正在讀取播放歷史...',
  'historyPage.loadingMore': '正在載入...',
  'historyPage.metric.plays': '{count} 次',
  'historyPage.metric.tracks': '{count} 首',
  'historyPage.refresh.none': '沒有發現失效歷史歌曲。',
  'historyPage.refresh.removed': '已移除 {count} 首失效歷史歌曲。',
  'historyPage.refresh.running': '正在刷新...',
  'historyPage.recent.aria': '最近播放列表',
  'historyPage.recent.count': '最近 {count} 首',
  'historyPage.recent.empty': '暫無最近播放。',
  'historyPage.recent.kicker': '按時間排序',
  'historyPage.recent.title': '最近播放列表',
  'historyPage.search.placeholder': '搜尋標題、藝術家、專輯或路徑',
  'historyPage.summary.all.count': '總播放',
  'historyPage.summary.all.duration': '總時長',
  'historyPage.summary.all.group': '按播放次數排序',
  'historyPage.summary.all.latest': '最近播放時間',
  'historyPage.summary.all.tracks': '歷史曲目',
  'historyPage.summary.aria': '歷史概覽',
  'historyPage.summary.completed.count': '完整播放',
  'historyPage.summary.completed.duration': '完整播放時長',
  'historyPage.summary.completed.group': '按完整播放次數排序',
  'historyPage.summary.completed.latest': '最近完整播放',
  'historyPage.summary.completed.tracks': '完整播放曲目',
  'historyPage.summary.month.count': '本月播放',
  'historyPage.summary.month.duration': '本月時長',
  'historyPage.summary.month.group': '本月按播放次數排序',
  'historyPage.summary.month.latest': '本月最近播放',
  'historyPage.summary.month.tracks': '本月曲目',
  'historyPage.summary.today.count': '今日播放',
  'historyPage.summary.today.duration': '今日時長',
  'historyPage.summary.today.group': '今日按播放次數排序',
  'historyPage.summary.today.latest': '今日最近播放',
  'historyPage.summary.today.tracks': '今日曲目',
  'historyPage.summary.week.count': '本週播放',
  'historyPage.summary.week.duration': '本週時長',
  'historyPage.summary.week.group': '本週按播放次數排序',
  'historyPage.summary.week.latest': '本週最近播放',
  'historyPage.summary.week.tracks': '本週曲目',
  'historyPage.toolbar.aria': '歷史篩選',
  'route.home.description': '曲庫概覽與最近聆聽。',
  'route.home.label': '主頁',
  'home.artistLeaderboard.aria': '藝人排行榜',
  'home.artistLeaderboard.completionRate': '{rate}% 完播',
  'home.artistLeaderboard.emptyDescription': '播放更多音樂後，這裡會形成你的高頻藝人榜。',
  'home.artistLeaderboard.emptyTitle': '還沒有藝人排行',
  'home.artistLeaderboard.playCount': '{count} 次',
  'home.artistLeaderboard.title': '藝人排行榜',
  'home.count.tracks': '{count} 首',
  'home.date.none': '還沒有記錄',
  'home.date.unknown': '時間未知',
  'home.duration.hoursMinutes': '{hours} 小時 {minutes} 分鐘',
  'home.duration.hoursOnly': '{hours} 小時',
  'home.duration.minutes': '{count} 分鐘',
  'home.duration.zeroMinutes': '0 分鐘',
  'home.error.albumNotFound': '未找到專輯：{album}',
  'home.error.artistNotFound': '未找到藝人：{artist}',
  'home.error.desktopBridgeRandom': '桌面曲庫橋接不可用。請在 ECHO Next 桌面端生成隨機佇列。',
  'home.error.desktopBridgeRecommend': '桌面曲庫橋接不可用。請在 ECHO Next 桌面端刷新推薦。',
  'home.error.desktopBridgeView': '桌面曲庫橋接不可用。請在 ECHO Next 桌面端查看首頁。',
  'home.favoriteAlbums.aria': '你喜歡的專輯',
  'home.favoriteAlbums.emptyDescription': '播放更多專輯後，這裡會按聽過最多次數選出前四張。',
  'home.favoriteAlbums.emptyTitle': '還沒有常聽專輯',
  'home.favoriteAlbums.title': '你喜歡的專輯',
  'home.hero.action.continue': '繼續播放',
  'home.hero.action.viewQueue': '查看佇列',
  'home.hero.aria': '今日回聲',
  'home.hero.defaultTitle': '從你的音樂庫開始播放。',
  'home.hero.description.empty': '匯入音樂後，這裡會變成你的曲庫入口、最近播放和本週聆聽脈衝。',
  'home.hero.description.resume': '接上 {artist} 的「{title}」，或從最近入庫裡挑一張封面開始。',
  'home.hero.kicker': '今日回聲',
  'home.hero.nowPlaying': '正在播放',
  'home.hero.recentSignal': '最近訊號',
  'home.hero.statsAria': '曲庫統計',
  'home.metric.albums': '專輯',
  'home.metric.albumsDetail': '按作品聚合',
  'home.metric.artists': '藝人',
  'home.metric.folders': '資料夾',
  'home.metric.foldersDetail': '最近掃描 {date}',
  'home.metric.openAria': '打開{label}',
  'home.metric.songs': '歌曲',
  'home.metric.songsDetail': '總時長 {duration}',
  'home.month.label': '{month}月',
  'home.nowMeta.empty': '曲庫準備好後會顯示最近內容',
  'home.preferences.aria': '播放偏好',
  'home.recent.emptyAddedDescription': '匯入資料夾後，這裡會顯示最新進入曲庫的封面。',
  'home.recent.emptyAddedTitle': '還沒有最近入庫',
  'home.recent.emptyPlayedDescription': '開始播放後，這裡會出現最近聽過的專輯。',
  'home.recent.emptyPlayedTitle': '還沒有最近播放',
  'home.recent.nextPage': '下一頁',
  'home.recent.prevPage': '上一頁',
  'home.recent.tab.added': '新增於',
  'home.recent.tab.played': '已播放',
  'home.recent.tabsAria': '最近內容',
  'home.recent.title': '最近活動',
  'home.recommend.emptyDescription': '匯入專輯後，這裡會直接鋪滿你的專輯。',
  'home.recommend.emptyTitle': '還沒有可推薦專輯',
  'home.recommend.refresh': '刷新',
  'home.recommend.refreshing': '刷新中',
  'home.recommend.title': '為你推薦',
  'home.signalVisualizer.aria': '音訊視覺化',
  'home.status.loading': '正在整理首頁...',
  'home.week.emptyHint': '播放後，格子會按每週節奏被點亮。',
  'home.week.listenDuration': '聆聽時長',
  'home.week.playCount': '本週播放',
  'home.week.times': '次',
  'home.week.title': '本週回聲',
  'home.weekday.fri': '五',
  'home.weekday.mon': '一',
  'home.weekday.wed': '三',
  'home.weeklyHeatmap.activeWeeks': '{count} 週活躍',
  'home.weeklyHeatmap.aria': '近 {weeks} 週播放熱力圖',
  'home.weeklyHeatmap.dayAria': '{date}，{playCount} 次播放',
  'home.weeklyHeatmap.dayTitle': '{date} · {playCount} 次 · {duration}',
  'route.inbox.description': '每次掃描新增的歌曲。',
  'route.inbox.label': '收件箱',
  'inboxPage.action.addToQueue': '加入佇列',
  'inboxPage.action.generatePlaylist': '生成待聽歌單',
  'inboxPage.batch.latest': '最新掃描',
  'inboxPage.batch.recentAll': '最近全部掃描',
  'inboxPage.batch.selected': '指定掃描',
  'inboxPage.date.none': '尚無記錄',
  'inboxPage.empty.description': '完成一次曲庫掃描後，這裡會出現新增歌曲。',
  'inboxPage.empty.noMatch': '沒有符合的新歌',
  'inboxPage.empty.title': '還沒有新增記錄',
  'inboxPage.empty.tryFilter': '換個篩選條件再看看。',
  'inboxPage.error.desktopBridgeRead': '桌面橋接暫不可用，無法讀取新歌收件箱。',
  'inboxPage.facets.allAlbums': '全部專輯',
  'inboxPage.facets.allArtists': '全部藝人',
  'inboxPage.facets.allFolders': '全部資料夾',
  'inboxPage.facets.aria': '新歌收件箱維度篩選',
  'inboxPage.filter.all': '全部新增',
  'inboxPage.filter.aria': '問題分類篩選',
  'inboxPage.filter.clear': '清空篩選',
  'inboxPage.filter.metadataIssue': '資料異常',
  'inboxPage.filter.missingCover': '缺封面',
  'inboxPage.filter.suspiciousFile': '疑似異常',
  'inboxPage.filter.unknownAlbum': '未知專輯',
  'inboxPage.filter.unknownArtist': '未知藝人',
  'inboxPage.hero.kicker': 'LIBRARY INBOX',
  'inboxPage.loading': '正在讀取收件箱...',
  'inboxPage.processing.aria': '本批待處理',
  'inboxPage.processing.pending': '待聽 / 待處理',
  'inboxPage.quality.aria': '入庫品質摘要',
  'inboxPage.quality.coverCompleteness': '封面完整率',
  'inboxPage.quality.metadataCompleteness': '資料完整率',
  'inboxPage.quality.unknownArtistAlbum': '未知藝人 / 專輯',
  'inboxPage.search.aria': '搜尋新歌收件箱',
  'inboxPage.search.placeholder': '搜尋標題、藝人、專輯、路徑',
  'inboxPage.stats.aria': '新歌收件箱摘要',
  'inboxPage.stats.currentResults': '目前結果',
  'inboxPage.stats.newSongs': '新增歌曲',
  'inboxPage.status.all': '全部狀態',
  'inboxPage.status.aria': '處理狀態篩選',
  'inboxPage.status.ignored': '已忽略',
  'inboxPage.status.pending': '待處理',
  'inboxPage.status.processed': '已處理',
  'inboxPage.story.aria': '入庫故事',
  'inboxPage.story.clean': '{summary}。資料看起來很乾淨。',
  'inboxPage.story.empty': '完成一次掃描後，ECHO 會把新增歌曲、專輯和資料問題整理在這裡。',
  'inboxPage.story.kicker': 'IMPORT STORY',
  'inboxPage.story.newAlbums': '新增專輯',
  'inboxPage.story.newArtists': '新增藝人',
  'inboxPage.story.summaryAlbums': '{count} 張專輯',
  'inboxPage.story.summaryArtists': '{count} 位藝人',
  'inboxPage.story.summaryTracks': '{scope}新增 {count} 首',
  'inboxPage.story.totalDuration': '總時長',
  'inboxPage.story.warningMetadataIssue': '{count} 首資料異常',
  'inboxPage.story.warningMissingCover': '{count} 首缺封面',
  'inboxPage.story.withWarnings': '{summary}。其中 {warnings}。',
  'inboxPage.toolbar.aria': '新歌收件箱篩選',
  'inboxPage.toolbar.batch': '批次',
  'route.importFile.label': '匯入檔案',
  'route.importFolder.description': '選擇本機音樂資料夾。',
  'route.importFolder.label': '匯入資料夾',
  'importFolder.hero.note': '此頁面只用於本機曲庫匯入和掃描狀態查看。',
  'nowPlaying.action.openLyrics': '打開歌詞',
  'nowPlaying.description': '目前曲目概覽。歌詞請從底部播放器的麥克風按鈕進入獨立頁面。',
  'nowPlaying.emptyDescription': '從歌曲列表或專輯開始播放後，這裡會顯示目前曲目。',
  'nowPlaying.emptyTitle': '暫無播放',
  'nowPlaying.kicker': '正在播放',
  'nowPlaying.localFile': '本機檔案',
  'nowPlaying.ready': '就緒',
  'nowPlaying.state.idle': '閒置',
  'nowPlaying.state.playing': '播放中',
  'nowPlaying.title': '正在播放',
  'route.liked.label': '喜歡',
  'route.lyrics.description': '歌詞與沉浸播放。',
  'route.lyrics.label': '歌詞',
  'route.lyricsSettings.label': '歌詞設定',
  'lyricsSettings.action.choose': '選擇',
  'lyricsSettings.action.fonts': '字體',
  'lyricsSettings.action.match': '匹配',
  'lyricsSettings.action.music': '音樂',
  'lyricsSettings.action.reset': '重置',
  'lyricsSettings.action.search': '搜尋',
  'lyricsSettings.background.blur': '背景模糊度',
  'lyricsSettings.background.brightness': '背景亮度',
  'lyricsSettings.background.chooseWallpaper': '選擇自訂桌布',
  'lyricsSettings.background.clearWallpaper': '清除自訂桌布',
  'lyricsSettings.background.clearWallpaperHint': '恢復為跟隨主題',
  'lyricsSettings.background.highResolutionCover': '請求網路中繼資料的高清封面',
  'lyricsSettings.background.highResolutionCoverDescription': '僅在跟隨封面時暫時請求高清封面作為歌詞背景；關閉時只使用本機封面備援。',
  'lyricsSettings.background.mode.cover': '跟隨封面',
  'lyricsSettings.background.mode.coverColor': '封面取色',
  'lyricsSettings.background.mode.customWallpaper': '自訂桌布',
  'lyricsSettings.background.mode.theme': '跟隨主題',
  'lyricsSettings.background.modeAria': '歌詞背景模式',
  'lyricsSettings.background.modeDescription': '封面模式會使用目前歌曲封面；封面取色只提取目前封面主色；自訂桌布會儲存到應用程式資料目錄。',
  'lyricsSettings.background.opacity': '背景透明度',
  'lyricsSettings.background.readability': '歌詞可讀性增強',
  'lyricsSettings.background.readabilityDescription': '為沉浸式 MV 背景上的歌詞增加描邊和陰影；不用展開沉浸式 MV 背景設定也可以常駐開關。',
  'lyricsSettings.background.scale': '背景放大',
  'lyricsSettings.background.showControls': '顯示歌詞背景設定',
  'lyricsSettings.background.smartReadable': '智慧可讀顏色',
  'lyricsSettings.background.smartReadableDescription': '根據封面、桌布或 MV 畫面自動選擇高對比文字色，並視需要增加輕遮罩、描邊和陰影。關閉時繼續使用手動歌詞顏色。',
  'lyricsSettings.background.title': '歌詞背景',
  'lyricsSettings.background.tuning': '背景調節',
  'lyricsSettings.background.tuningDescription': '跟隨封面和自訂桌布都會使用這裡的透明度、模糊度和亮度。',
  'lyricsSettings.background.wallpaperSaved': '已儲存到應用桌布目錄',
  'lyricsSettings.candidate.allSources': '全部來源',
  'lyricsSettings.candidate.results': '歌詞搜尋結果',
  'lyricsSettings.candidate.risk.high': '需要確認',
  'lyricsSettings.candidate.risk.low': '精準匹配',
  'lyricsSettings.candidate.risk.medium': '可能匹配',
  'lyricsSettings.candidate.reason.albumMatch': '專輯匹配',
  'lyricsSettings.candidate.reason.artistExact': '藝人一致',
  'lyricsSettings.candidate.reason.artistMismatch': '藝人不符',
  'lyricsSettings.candidate.reason.autoAccept': '自動採用',
  'lyricsSettings.candidate.reason.candidateOnlyCover': '翻唱需確認',
  'lyricsSettings.candidate.reason.candidateOnlyDuration': '時長需確認',
  'lyricsSettings.candidate.reason.coverIntent': '翻唱候選',
  'lyricsSettings.candidate.reason.durationClose': '時長接近',
  'lyricsSettings.candidate.reason.durationExact': '時長精準',
  'lyricsSettings.candidate.reason.durationMismatch': '時長不符',
  'lyricsSettings.candidate.reason.embeddedTag': '內嵌歌詞',
  'lyricsSettings.candidate.reason.localSidecar': '本地歌詞',
  'lyricsSettings.candidate.reason.rejectedByUser': '已拒絕',
  'lyricsSettings.candidate.reason.syncedDurationSafe': '同步安全',
  'lyricsSettings.candidate.reason.titleExact': '標題一致',
  'lyricsSettings.candidate.reason.titleSimilar': '標題接近',
  'lyricsSettings.candidate.reason.versionConflict': '版本衝突',
  'lyricsSettings.candidate.reason.versionMatch': '版本匹配',
  'lyricsSettings.candidate.sourceFilters': '歌詞來源篩選',
  'lyricsSettings.candidate.type.instrumental': '純音樂',
  'lyricsSettings.candidate.type.lyrics': '歌詞',
  'lyricsSettings.candidate.type.plain': '純文字',
  'lyricsSettings.candidate.type.synced': '逐行同步',
  'lyricsSettings.currentTrack.instrumentalMarked': '已標記為純音樂',
  'lyricsSettings.currentTrack.markInstrumental': '標記為純音樂',
  'lyricsSettings.currentTrack.markInstrumentalHint': '記住目前歌曲並停止自動歌詞匹配',
  'lyricsSettings.currentTrack.rematch': '重新匹配',
  'lyricsSettings.currentTrack.rematchHint': '清理目前快取並重新尋找',
  'lyricsSettings.currentTrack.restartOnApply': '套用歌詞後自動重播音樂',
  'lyricsSettings.currentTrack.restartOnApplyDescription': '預設關閉；開啟後，成功套用目前歌曲歌詞時會從頭播放，避免歌詞時間軸沿用舊進度而不同步。',
  'lyricsSettings.currentTrack.searchHint': '留空則使用目前歌曲資訊',
  'lyricsSettings.currentTrack.searchInput': '搜尋歌詞文字',
  'lyricsSettings.currentTrack.searchLyrics': '搜尋歌詞',
  'lyricsSettings.currentTrack.searchPlaceholder': '歌名 / 演出者 / 關鍵字',
  'lyricsSettings.currentTrack.title': '目前歌曲',
  'lyricsSettings.display.autoOpenCandidatePanel': '自動彈出歌詞選擇欄',
  'lyricsSettings.display.chooseMiniPlayerColor': '選擇底欄顏色',
  'lyricsSettings.display.coverMiniPlayerHint': '會從目前歌曲封面擷取顏色，並自動壓暗成適合按鈕閱讀的玻璃色。',
  'lyricsSettings.display.customColor': '自訂顏色',
  'lyricsSettings.display.defaultMicrosoftYahei': '預設微軟雅黑，可換系統字體',
  'lyricsSettings.display.desktopFont': '桌面歌詞字體',
  'lyricsSettings.display.desktopLyrics': '桌面歌詞',
  'lyricsSettings.display.desktopLyricsDescription': '開啟後用獨立透明視窗在桌面置頂顯示目前歌詞。',
  'lyricsSettings.display.desktopOpacity': '桌面歌詞透明度',
  'lyricsSettings.display.desktopOpacityDescription': '目前 {opacity}%，調低可減少遮擋。',
  'lyricsSettings.display.desktopRomanization': '桌面歌詞顯示羅馬音',
  'lyricsSettings.display.desktopTranslation': '桌面歌詞顯示翻譯',
  'lyricsSettings.display.disableMvTrackInfoAutoShow': '關閉 MV 自動顯示歌曲資訊',
  'lyricsSettings.display.enableLyrics': '啟用歌詞',
  'lyricsSettings.display.enableLyricsDescription': '關閉後歌詞頁不會載入、搜尋或匹配歌詞。',
  'lyricsSettings.display.hideEmptyState': '隱藏純音樂提示',
  'lyricsSettings.display.hideEmptyStateDescription': '隱藏歌詞頁中央的「純音樂，請欣賞」和「暫無歌詞」提示，預設開啟。',
  'lyricsSettings.display.hideTrackInfo': '隱藏歌曲資訊',
  'lyricsSettings.display.lockDesktopLyrics': '鎖定桌面歌詞',
  'lyricsSettings.display.lockDesktopLyricsDescription': '鎖定後滑鼠會穿透桌面歌詞，避免擋住桌面操作；回到這裡可解鎖。',
  'lyricsSettings.display.matchThreshold': '歌詞匹配度設定',
  'lyricsSettings.display.matchThresholdDescription': '線上結果達到 {threshold}% 才會自動套用',
  'lyricsSettings.display.miniPlayer': '迷你底欄',
  'lyricsSettings.display.miniPlayerAutoHide': '自動隱藏迷你底欄',
  'lyricsSettings.display.miniPlayerAutoHideDescription': '開啟後滑鼠離開底欄一段距離會自動收起；移回底部附近會順滑顯示，預設關閉。',
  'lyricsSettings.display.miniPlayerAutoMv': '播放 MV 時自動啟用',
  'lyricsSettings.display.miniPlayerAutoMvDescription': '開啟後進入 MV 頁面會自動使用迷你底欄；一般歌詞頁仍依上方開關決定。',
  'lyricsSettings.display.miniPlayerColor': '底欄顏色',
  'lyricsSettings.display.miniPlayerColorMode': '迷你底欄顏色模式',
  'lyricsSettings.display.miniPlayerDefaultDark': '預設深色',
  'lyricsSettings.display.miniPlayerDescription': '開啟後歌詞頁會隱藏預設底部播放欄，改用貼在底部中央的小型控制條。',
  'lyricsSettings.display.miniPlayerHint': '預設開啟；適合想保留歌詞沉浸感、但仍要快速切歌和拖動進度時使用。',
  'lyricsSettings.display.miniPlayerOpacity': '底欄透明度',
  'lyricsSettings.display.miniPlayerPalette': '迷你底欄顏色調色盤',
  'lyricsSettings.display.preferUtatenKana': '優先 UtaTen 假名注音',
  'lyricsSettings.display.preferUtatenKanaDescription': '預設關閉；開啟後日文歌詞會嘗試用 UtaTen 的ふりがな替代羅馬音顯示，匹配不到會自動回退。',
  'lyricsSettings.display.resetDesktopPosition': '重置桌面歌詞位置',
  'lyricsSettings.display.resetDesktopPositionHint': '移回螢幕下方中央',
  'lyricsSettings.display.showRomanization': '顯示羅馬音',
  'lyricsSettings.display.showRomanizationDescription': '優先使用歌詞源提供的羅馬音；沒有時會為日文歌詞本機生成。',
  'lyricsSettings.display.showTranslation': '顯示中文翻譯',
  'lyricsSettings.display.showTranslationDescription': '優先顯示歌詞源提供的中文翻譯；沒有翻譯時不顯示額外文字。',
  'lyricsSettings.display.title': '歌詞顯示',
  'lyricsSettings.display.useMiniPlayerColor': '使用底欄顏色 {color}',
  'lyricsSettings.drawer.aria': '歌詞設定',
  'lyricsSettings.drawer.close': '關閉歌詞設定',
  'lyricsSettings.drawer.title': '歌詞設定',
  'lyricsSettings.engine.autoMatch': '自動匹配',
  'lyricsSettings.engine.provider': '來源',
  'lyricsSettings.engine.threshold': '閾值',
  'lyricsSettings.engine.title': '歌詞引擎',
  'lyricsSettings.font.applySystem': '套用系統字體',
  'lyricsSettings.font.chooseInstalled': '選擇已安裝字體',
  'lyricsSettings.font.custom': '自訂',
  'lyricsSettings.font.desktopOnly': '只影響桌面歌詞',
  'lyricsSettings.font.importDesktop': '匯入桌面歌詞字體',
  'lyricsSettings.font.importFile': '匯入字體檔案',
  'lyricsSettings.font.lyricsOnly': '只影響歌詞頁和歌詞行',
  'lyricsSettings.font.restoreDesktopDefault': '恢復桌面歌詞預設字體',
  'lyricsSettings.font.restoreLyricsDefault': '恢復預設歌詞字體',
  'lyricsSettings.font.system': '系統字體',
  'lyricsSettings.fontPicker.aria': '選擇歌詞字體',
  'lyricsSettings.fontPicker.chooseFile': '從檔案選擇字體',
  'lyricsSettings.fontPicker.close': '關閉歌詞字體選擇',
  'lyricsSettings.fontPicker.preview': '歌詞字體預覽 Aa 你好',
  'lyricsSettings.fontPicker.searchPlaceholder': '搜尋已安裝字體',
  'lyricsSettings.fontPicker.title': '選擇歌詞字體',
  'lyricsSettings.provider.cached': '快取歌詞',
  'lyricsSettings.provider.amllTtml': 'AMLL TTML',
  'lyricsSettings.provider.amllTtmlDescription': '逐詞 TTML 歌詞庫，需要匹配網易雲 ID，預設關閉',
  'lyricsSettings.provider.chineseCatalogDescription': '中文曲庫補充',
  'lyricsSettings.provider.genius': 'Genius',
  'lyricsSettings.provider.kugou': '酷狗音樂',
  'lyricsSettings.provider.kuwo': '酷我音樂',
  'lyricsSettings.provider.local': '本地歌詞',
  'lyricsSettings.provider.lrclib': 'LRCLIB',
  'lyricsSettings.provider.lrclibDescription': '開放歌詞庫',
  'lyricsSettings.provider.manual': '手動歌詞',
  'lyricsSettings.provider.musixmatch': 'Musixmatch',
  'lyricsSettings.provider.netease': '網易雲音樂',
  'lyricsSettings.provider.none': '未套用歌詞',
  'lyricsSettings.provider.qqmusic': 'QQ 音樂',
  'lyricsSettings.preview.primary': '歌詞預覽',
  'lyricsSettings.preview.secondary': '輔助歌詞行',
  'lyricsSettings.online.autoSearch': '自動匹配歌詞',
  'lyricsSettings.online.autoSearchDescription': '本地歌詞始終優先；線上結果達到閾值才會自動套用。',
  'lyricsSettings.online.autoSaveSidecar': '自動儲存本地歌詞檔',
  'lyricsSettings.online.autoSaveSidecarDescription': '預設關閉；線上或手動套用的歌詞會儲存為歌曲同名旁掛檔，不覆蓋既有 .lrc / .ttml / .txt。',
  'lyricsSettings.online.deepSearch': '深度優先搜尋',
  'lyricsSettings.online.deepSearchDescription': '開啟後多個線上平台會並行搜尋；任一結果達到自動套用門檻就會立即停止其他來源並返回。',
  'lyricsSettings.online.enable': '啟用線上歌詞匹配',
  'lyricsSettings.online.enableDescription': '僅傳送標題、演出者、專輯和時長用於匹配。',
  'lyricsSettings.online.sources': '歌詞來源',
  'lyricsSettings.online.sourcesDescription': '本地歌詞會一直優先；未勾選的線上來源不會參與自動匹配或重新匹配。',
  'lyricsSettings.online.title': '線上匹配',
  'lyricsSettings.status.applied': '已套用歌詞',
  'lyricsSettings.status.applying': '套用中',
  'lyricsSettings.status.auto': '自動',
  'lyricsSettings.status.markedInstrumental': '已標記為純音樂',
  'lyricsSettings.status.noCandidates': '未找到歌詞候選',
  'lyricsSettings.status.noPlayingTrack': '沒有正在播放的歌曲',
  'lyricsSettings.status.normal': '正常',
  'lyricsSettings.status.off': '關閉',
  'lyricsSettings.status.on': '開啟',
  'lyricsSettings.status.rematchingCandidates': '正在重新匹配歌詞...',
  'lyricsSettings.status.searchingCandidates': '正在搜尋歌詞候選...',
  'lyricsSettings.style.chooseLyricsColor': '選擇歌詞顏色',
  'lyricsSettings.style.contextOpacity': '上下文透明度',
  'lyricsSettings.style.fontSize': '歌詞字號',
  'lyricsSettings.style.lineMaxChars': '每行字數',
  'lyricsSettings.style.lineMaxCharsValue': '{count}字',
  'lyricsSettings.style.lineSpacing': '歌詞行距',
  'lyricsSettings.style.lyricsColor': '歌詞顏色',
  'lyricsSettings.style.lyricsColorPalette': '歌詞顏色調色盤',
  'lyricsSettings.style.lyricsFont': '歌詞字體',
  'lyricsSettings.style.secondaryFontSize': '輔助歌詞字號',
  'lyricsSettings.style.showControls': '顯示歌詞樣式設定',
  'lyricsSettings.style.showControlsDescription': '包含輔助字號、歌詞字號、歌詞行距、上下文透明度和歌詞顏色。',
  'lyricsSettings.style.useColor': '使用顏色 {color}',
  'lyricsSettings.timing.defaultOffset': '新歌詞預設延遲',
  'lyricsSettings.timing.globalOffset': '全域延遲',
  'lyricsSettings.timing.restoreDefaults': '恢復歌詞預設值',
  'lyricsSettings.timing.restoreDefaultsHint': '匹配閾值 50% / 延遲 0ms',
  'lyricsSettings.timing.showPerTrackOffset': '顯示本歌曲延遲校準',
  'lyricsSettings.timing.smartAlignment': '智慧歌詞校準',
  'lyricsSettings.timing.smartAlignmentDescription': '高可信時自動儲存目前歌曲延遲；異常漂移只提示換源，可撤回。',
  'lyricsSettings.timing.timelineCorrection': '套用歌詞時間軸校準',
  'lyricsSettings.timing.timelineCorrectionDescription': '全域延遲會影響所有歌曲；本歌曲延遲請在歌詞頁校準條裡調整，會跟隨目前歌曲單獨記憶。',
  'lyricsSettings.timing.title': '匹配與延遲',
  'lyricsSettings.wordHighlight.clarity': '逐字高亮清晰度',
  'lyricsSettings.wordHighlight.clarityDescription': '預設「正常」；調高會讓目前詞未唱到的部分更完整，調低會更有逐字推進感。',
  'lyricsSettings.wordHighlight.description': '僅在歌詞檔案含真實逐字時間戳時啟用；否則保持整行高亮。',
  'lyricsSettings.wordHighlight.title': '逐字歌詞高亮',
  'route.mvSettings.description': 'MV 綁定與本地匹配設定。',
  'route.mvSettings.label': 'MV 設定',
  'mvSettings.action.chooseFile': '匯入本地影片',
  'mvSettings.action.close': '關閉 MV 設定',
  'mvSettings.action.collapseNetwork': '折疊網路來源',
  'mvSettings.action.dragReorder': '拖曳調整優先級',
  'mvSettings.action.dragSource': '拖曳 {provider} 調整優先級',
  'mvSettings.action.expandNetwork': '展開網路來源',
  'mvSettings.action.findLocal': '尋找本地',
  'mvSettings.action.openExternal': '在外部打開已選 MV',
  'mvSettings.action.refresh': '重新整理',
  'mvSettings.action.removeSelected': '移除已選 MV',
  'mvSettings.action.searchNetwork': '搜尋網路 MV',
  'mvSettings.aria.candidates': 'MV 候選列表',
  'mvSettings.aria.drawer': 'MV 設定',
  'mvSettings.aria.engineStatus': 'MV 引擎狀態',
  'mvSettings.aria.maxQuality': '最高畫質 {quality}',
  'mvSettings.aria.maxQualityOptions': '最高畫質選項',
  'mvSettings.aria.networkSources': '網路來源優先級',
  'mvSettings.aria.selectedQuality': '已選 MV 畫質 {quality}',
  'mvSettings.aria.selectedQualityOptions': '已選 MV 畫質選項',
  'mvSettings.badge.credentialsMain': '憑證保留在主行程',
  'mvSettings.badge.proxyOnly': '僅代理存取',
  'mvSettings.binding.selectedMv': '已選 MV',
  'mvSettings.binding.title': 'MV 來源',
  'mvSettings.candidate.external': '外部',
  'mvSettings.candidate.inApp': '應用內',
  'mvSettings.custom.apply': '套用自訂 MV',
  'mvSettings.custom.description': '貼上 YouTube 或 Bilibili 影片連結作為目前 MV。',
  'mvSettings.custom.directDash': '直連串流（DASH）',
  'mvSettings.custom.input': '自訂 MV 連結',
  'mvSettings.custom.placeholder': 'https://youtube.com/watch?v=... 或 BVxxxxxxxx',
  'mvSettings.custom.playing': '正在播放：{provider} - {sourceId}',
  'mvSettings.custom.title': '自訂 MV',
  'mvSettings.custom.videoTitle': '影片標題：{title}',
  'mvSettings.engine.mvTitle': 'MV 標題',
  'mvSettings.engine.network': '網路',
  'mvSettings.engine.quality': '畫質',
  'mvSettings.engine.selected': '已選',
  'mvSettings.engine.title': 'MV 引擎',
  'mvSettings.error.noActiveTrackBinding': '沒有可用於 MV 綁定的目前曲庫歌曲',
  'mvSettings.error.noActiveTrackMatching': '沒有可用於 MV 匹配的目前曲庫歌曲',
  'mvSettings.error.noActiveTrackNetworkSearch': '沒有可用於網路 MV 搜尋的目前曲庫歌曲',
  'mvSettings.error.databaseUnavailable': 'MV 資料庫暫時無法讀取，請先到曲庫恢復裡修復資料庫。',
  'mvSettings.error.noLocalCandidates': '沒有找到本地 MV 候選',
  'mvSettings.error.noNetworkCandidates': '沒有找到網路 MV 候選',
  'mvSettings.general.enabled': '啟用 MV',
  'mvSettings.immersive.blur': '毛玻璃模糊',
  'mvSettings.immersive.autoScale': '自動縮放',
  'mvSettings.immersive.autoScaleDescription': '依照 MV 寬高自動補償縮放，盡量避免背景黑邊。',
  'mvSettings.immersive.brightness': '背景亮度',
  'mvSettings.immersive.description': '開啟後，歌詞頁使用目前 MV 作為背景。',
  'mvSettings.immersive.dragHint': '也可以在歌詞頁空白處拖動調整。',
  'mvSettings.immersive.hideLyrics': 'MV 介面隱藏歌詞',
  'mvSettings.immersive.hideLyricsDescription': '開啟後，切到 MV 介面時不顯示歌詞文字；預設關閉。',
  'mvSettings.immersive.lyricsReadability': '歌詞可讀性增強',
  'mvSettings.immersive.lyricsReadabilityDescription': '為沉浸式 MV 上的歌詞增加描邊和投影。',
  'mvSettings.immersive.overlay': '暗色遮罩',
  'mvSettings.immersive.overlayHint': '越低越接近原片，越高歌詞越清晰。',
  'mvSettings.immersive.positionX': '橫向位置',
  'mvSettings.immersive.positionY': '縱向位置',
  'mvSettings.immersive.reset': '重置沉浸式背景',
  'mvSettings.immersive.title': '沉浸式 MV 背景',
  'mvSettings.immersive.tuning': '沉浸式背景調節',
  'mvSettings.immersive.visualHint': '用於調整沉浸式背景觀感。',
  'mvSettings.immersive.zoom': '背景縮放',
  'mvSettings.network.autoApply': '自動搜尋網路 MV',
  'mvSettings.network.autoApplyThreshold': '自動套用匹配度',
  'mvSettings.network.autoApplyThresholdDescription': '候選達到 {threshold} 以上才會自動套用。',
  'mvSettings.network.autoPreload': '是否預載 MV',
  'mvSettings.network.autoPreloadDescription': '開啟後，只要播放歌曲就會嘗試提前查找並準備目前歌曲的 MV。',
  'mvSettings.network.diagnosticsReport': 'MV 診斷報告',
  'mvSettings.network.diagnosticsReportDescription': '預設關閉；開啟後，MV 頁面無畫面時顯示可複製的本機診斷資訊。',
  'mvSettings.network.maxQuality': '最高畫質',
  'mvSettings.network.preferHighestViewCount': '按播放量匹配',
  'mvSettings.network.preferHighestViewCountDescription': '開啟後自動搜尋只用歌名和歌手，並優先選擇播放量最高的可播放 MV。',
  'mvSettings.network.replayAudioOnChange': '切換 MV 後自動重播音樂',
  'mvSettings.network.replayAudioOnChangeDescription': '開啟後，手動選擇或綁定新的 MV 會重新播放目前歌曲，讓新 MV 立即生效。',
  'mvSettings.network.restartAudioOnLoad': 'MV 跟隨音樂進度',
  'mvSettings.network.restartAudioOnLoadDescription': '開啟後，會持續校準 MV 影片時間，不會 seek 或重啟音訊；歌詞同步偏移不會影響 MV。',
  'mvSettings.network.syncMode': '同步模式',
  'mvSettings.network.syncModeDescription': '輕微偏差用變速追平，大偏差才跳轉影片。',
  'mvSettings.network.syncMode.stable': '穩定',
  'mvSettings.network.syncMode.balanced': '均衡',
  'mvSettings.network.syncMode.precise': '精準',
  'mvSettings.network.title': '網路來源',
  'mvSettings.offset.aria': 'MV 同步延遲',
  'mvSettings.offset.description': '正數讓 MV 畫面提前，負數讓 MV 畫面延後；只記住目前歌曲的 MV。',
  'mvSettings.offset.earlier': 'MV 提前 {value}',
  'mvSettings.offset.earlierShort': '提前 {value}',
  'mvSettings.offset.input': '偏移秒數',
  'mvSettings.offset.later': 'MV 延後 {value}',
  'mvSettings.offset.laterShort': '延後 {value}',
  'mvSettings.offset.replay': '重播',
  'mvSettings.offset.replayTitle': '重新播放目前歌曲，並按 MV 起播點同步影片',
  'mvSettings.offset.reset': '重置 MV 延遲',
  'mvSettings.offset.resetShort': '重置',
  'mvSettings.offset.slider': 'MV 同步延遲滑桿',
  'mvSettings.offset.startDescription': '輸入影片裡的起點秒數，最高 600 秒；這首歌會直接從那裡對齊播放。',
  'mvSettings.offset.startInput': 'MV 起播秒數',
  'mvSettings.offset.startTitle': '從第幾秒開始播放',
  'mvSettings.offset.step': '調節步長',
  'mvSettings.offset.title': 'MV 音畫校準',
  'mvSettings.provider.local': '本地',
  'mvSettings.quality.max': '最高',
  'mvSettings.search.input': 'MV 搜尋關鍵字',
  'mvSettings.search.placeholder': '輸入 MV 搜尋關鍵字',
  'mvSettings.search.useCurrentSong': '使用目前歌曲和歌手搜尋',
  'mvSettings.status.auto': '自動',
  'mvSettings.status.noActiveTrack': '沒有目前歌曲',
  'mvSettings.status.none': '無',
  'mvSettings.status.off': '關閉',
  'mvSettings.status.on': '開啟',
  'mvSettings.title': 'MV 設定',
  'route.playlists.label': '播放清單',
  'playlistsPage.action.importFile': '匯入 M3U/M3U8 歌單',
  'playlistsPage.action.newLocal': '新建本地歌單',
  'playlistsPage.daily.subtitle': '網易雲帳號推薦',
  'playlistsPage.daily.title': '每日推薦',
  'playlistsPage.empty.create': '新建歌單',
  'playlistsPage.empty.createFirst': '建立第一個本地歌單',
  'playlistsPage.empty.local': '還沒有本地歌單。',
  'playlistsPage.error.desktopBridgeDailyRecommend': 'Desktop bridge unavailable. Open ECHO Next in Electron to refresh NetEase daily recommendations.',
  'playlistsPage.form.cancel': '取消新建',
  'playlistsPage.form.create': '建立',
  'playlistsPage.form.nameAria': '本地歌單名稱',
  'playlistsPage.form.placeholder': '新建本地歌單',
  'playlistsPage.importStreaming.add': '添加歌單',
  'playlistsPage.importStreaming.adding': '添加中',
  'playlistsPage.importStreaming.placeholder': '貼上網易雲 / QQ 音樂 / 酷狗 / Spotify 歌單連結',
  'playlistsPage.importStreaming.title': '添加串流歌單',
  'playlistsPage.prompt.newLocalName': '新建本地歌單名稱',
  'playlistsPage.status.createdLocal': '本地歌單已建立',
  'playlistsPage.status.importedStreamingPlaylist': '已添加歌單：{name}，共 {count} 首',
  'playlistsPage.status.importingStreamingPlaylist': '正在添加串流歌單...',
  'playlistsPage.status.loading': '正在讀取歌單...',
  'playlistsPage.status.refreshedDaily': '已刷新每日推薦：{count} 首',
  'playlistsPage.status.refreshingDaily': '正在刷新網易雲每日推薦...',
  'playlistsPage.view.aria': '播放清單視圖',
  'playlistsPage.view.local': '本地歌單',
  'playlistsPage.view.streamingFavorites': '串流收藏',
  'route.plugins.description': '本機可編輯外掛。',
  'route.plugins.label': '外掛',
  'route.queue.label': '佇列',
  'queue.action.clear': '清空佇列',
  'queue.action.dragLabel': '拖曳 {title}',
  'queue.action.dragTitle': '拖曳排序',
  'queue.action.generateFromHistory': '依播放歷史產生佇列',
  'queue.action.generateRandom': '產生隨機佇列',
  'queue.action.generatingHistory': '產生中',
  'queue.action.generatingRandom': '產生中',
  'queue.action.autoFill': '自動補齊佇列',
  'queue.action.like': '喜歡',
  'queue.action.more': '更多',
  'queue.action.openFolder': '打開所在資料夾',
  'queue.action.play': '立即播放 {title}',
  'queue.action.playNext': '下一首播放 {title}',
  'queue.action.remove': '移除 {title}',
  'queue.action.shuffle': '隨機播放',
  'queue.count': '{count} 首',
  'queue.empty.description': '播放歌曲、加入佇列或選擇下一首播放後，這裡會出現佇列內容。',
  'queue.empty.title': '還沒有接下來播放的歌曲',
  'queue.error.desktopBridge': '桌面橋接不可用。請在 ECHO Next 桌面端讀取曲庫。',
  'queue.error.noHistoryTracks': '還沒有可用來產生佇列的播放歷史。',
  'queue.error.noRandomTracks': '曲庫裡還沒有可加入隨機佇列的歌曲。',
  'queue.header.kicker': '播放佇列',
  'queue.header.title': '佇列',
  'queue.historySource': '歷史常聽',
  'queue.now.actions': '目前曲目操作',
  'queue.now.emptyDescription': '從歌曲或專輯開始播放後，這裡會顯示目前曲目。',
  'queue.now.emptyTitle': '還沒有正在播放的歌曲',
  'queue.now.kicker': '正在播放',
  'queue.now.quality': '音訊品質',
  'queue.now.sourceFallback': '佇列',
  'queue.now.waitingAudio': '等待音訊資訊',
  'queue.quality.unknown': '未知',
  'queue.randomSource': '隨機佇列',
  'queue.repeat.all': '佇列',
  'queue.repeat.mode': '循環模式',
  'queue.repeat.off': '關閉',
  'queue.repeat.one': '單曲',
  'queue.tools': '佇列工具',
  'queue.upNext.kicker': '接下來',
  'queue.upNext.title': '接下來播放',
  'queue.upNext.waitingCount': '{count} 首等待',
  'queue.unknownAlbum': '未知專輯',
  'queue.unknownArtist': '未知演出者',
  'route.remote.label': '網路硬碟 / 遠端',
  'route.settings.label': '設定',
  'route.songs.label': '曲目',
  'songs.action.clearList': '清空列表',
  'songs.action.openRecovery': '前往復原助手',
  'songs.duplicatesOnly': '只看重複歌曲',
  'songs.error.albumNotFound': '未找到專輯：{album}',
  'songs.error.artistNotFound': '未找到藝人：{artist}',
  'songs.error.desktopBridgeClear': 'Desktop bridge unavailable. Open ECHO Next in Electron to clear the library list.',
  'songs.error.desktopBridgeFileActions': 'Desktop bridge unavailable. Open ECHO Next in Electron to use file actions.',
  'songs.error.desktopBridgeLyricsCache': 'Desktop bridge unavailable. Open ECHO Next in Electron to clear lyrics cache.',
  'songs.error.desktopBridgeMaintain': 'Desktop bridge unavailable. Open ECHO Next in Electron to maintain the library.',
  'songs.error.desktopBridgePlay': 'Desktop bridge unavailable. Open ECHO Next in Electron to play local files.',
  'songs.error.desktopBridgePlaylists': 'Desktop bridge unavailable. Open ECHO Next in Electron to use playlists.',
  'songs.error.desktopBridgeRead': 'Desktop bridge unavailable. Open ECHO Next in Electron to read the library.',
  'songs.error.desktopBridgeVersions': 'Desktop bridge unavailable. Open ECHO Next in Electron to inspect duplicate versions.',
  'songs.importHint': '也可以直接把音樂檔案或資料夾拖入視窗。支援 MP3、FLAC、WAV、ALAC、AAC、OPUS、OGG、APE、WV、DSF、DFF、CUE 等格式，更多格式會自動識別。',
  'songs.queueSource.local': '歌曲列表',
  'songs.queueSource.remote': '網盤歌曲',
  'songs.search.placeholder': '搜尋曲目 / 藝人 / 專輯...',
  'songs.sort.album': '按專輯',
  'songs.sort.artist': '按藝人',
  'songs.sort.artistAlbum': '按藝人 / 專輯',
  'songs.sort.createdAsc': '建立時間（正序）',
  'songs.sort.createdDesc': '建立時間（倒序）',
  'songs.sort.default': '預設排序',
  'songs.sort.durationAsc': '音樂時間（短到長）',
  'songs.sort.durationDesc': '音樂時間（長到短）',
  'songs.sort.fileModifiedAsc': '檔案修改時間（舊到新）',
  'songs.sort.fileModifiedDesc': '檔案修改時間（新到舊）',
  'songs.sort.frequent': '依常聽歌曲排序',
  'songs.sort.menuAria': '歌曲排序',
  'songs.sort.qualityAsc': '歌曲品質/大小（小到大）',
  'songs.sort.qualityDesc': '歌曲品質/大小（大到小）',
  'songs.sort.random': '隨機排序',
  'songs.sort.recent': '最近更新',
  'songs.sort.titleAsc': '歌曲名（A-Z）',
  'songs.sort.titleDesc': '歌曲名（Z-A）',
  'songs.trackList.aria': '歌曲列表',
  'songs.trackList.empty': '沒有可顯示的歌曲。匯入音樂資料夾後，這裡會顯示曲庫列表。',
  'route.streaming.description': '串流音樂來源。',
  'route.streaming.label': '串流',
  'streaming.empty.notFoundAlbum': '找不到匹配的專輯。',
  'streaming.empty.notFoundArtist': '找不到匹配的歌手。',
  'streaming.empty.notFoundPlaylist': '找不到匹配的歌單。',
  'streaming.empty.notFoundTrack': '找不到匹配的串流歌曲。',
  'streaming.empty.searchHint': '輸入關鍵字開始搜尋。播放時才會解析真實位址，佇列不會保存臨時 URL。',
  'streaming.hero.currentProvider': '目前來源',
  'streaming.hero.description': '搜尋線上曲庫，播放前臨時解析音訊位址。',
  'streaming.hero.meterAria': '目前串流狀態',
  'streaming.hero.preparingSearch': '準備搜尋',
  'streaming.hero.title': '串流音樂',
  'streaming.provider.available': '可用',
  'streaming.provider.disabled': '未啟用',
  'streaming.provider.loggedIn': '已登入 {name}',
  'streaming.provider.notLoggedIn': '未登入',
  'streaming.providers.aria': '串流平台',
  'streaming.quality.high': '高音質',
  'streaming.quality.highDescription': '優先 320kbps',
  'streaming.quality.hires': 'Hi-Res',
  'streaming.quality.hiresDescription': '平台可用時啟用',
  'streaming.quality.label': '音質',
  'streaming.quality.lossless': '無損',
  'streaming.quality.losslessDescription': '優先 FLAC',
  'streaming.quality.max': 'Max',
  'streaming.quality.maxDescription': '預設最高音質',
  'streaming.quality.menuAria': '音質',
  'streaming.quality.standard': '標準',
  'streaming.quality.standardDescription': '相容性更好',
  'streaming.quality.switchFailed': '切換音質失敗',
  'streaming.quality.switched': '已切換音質：{quality}',
  'streaming.result.count': '{count} 項結果',
  'streaming.result.searching': '搜尋中',
  'streaming.result.searchingEllipsis': '搜尋中...',
  'streaming.search.placeholder': '搜尋歌曲、歌手、專輯',
  'streaming.tab.album': '專輯',
  'streaming.tab.artist': '歌手',
  'streaming.tab.playlist': '歌單',
  'streaming.tab.track': '單曲',
  'streaming.tabs.aria': '結果類型',
  'settings.general.language.title': '顯示語言',
  'settings.general.language.description': '選擇選單、應用程式內設定與系統對話框的顯示語言。',
  'settings.about.version.title': '版本號',
  'settings.about.version.description': '目前安裝的 ECHO Next 版本。',
  'settings.about.updates.title': '自動更新',
  'settings.about.updates.description': '啟動後自動檢查 GitHub Release，下載完成後自動重新啟動安裝。',
  'settings.about.updates.currentVersion': '目前版本',
  'settings.about.updates.latestVersion': '最新版本',
  'settings.about.updates.status': '狀態',
  'settings.about.updates.lastChecked': '上次檢查',
  'settings.about.updates.autoCheck': '自動檢查更新',
  'settings.about.updates.action.check': '檢查更新',
  'settings.about.updates.action.checking': '檢查中...',
  'settings.about.updates.action.afdian': '愛發電',
  'settings.about.updates.action.history': '查看歷史更新日誌',
  'settings.about.updates.action.qq': '加入 QQ 群聊',
  'settings.about.updates.action.discord': '加入 Discord',
  'settings.about.updates.progress.ready': '下載完成，準備安裝',
  'settings.about.updates.progress.downloading': '正在下載更新',
  'settings.about.updates.progress.aria': 'OTA 更新下載進度 {percent}%',
  'settings.about.updates.releaseNotes': '更新日誌',
  'settings.about.updates.releaseNotesPending': '更新日誌稍後顯示...',
  'settings.about.updates.releaseNotesEmpty': '更新日誌會在 GitHub Release 回傳 release notes 後顯示。',
  'settings.about.updates.state.idle': '待檢查',
  'settings.about.updates.state.checking': '正在檢查',
  'settings.about.updates.state.available': '發現新版本',
  'settings.about.updates.state.downloading': '下載中',
  'settings.about.updates.state.downloaded': '下載完成，正在安裝',
  'settings.about.updates.state.notAvailable': '已是最新',
  'settings.about.updates.state.error': '檢查失敗',
  'settings.about.updates.state.disabled': '已關閉',
  'settings.general.dataBackup.title': '自動資料備份',
  'settings.general.dataBackup.description': '備份設定、曲庫索引、播放記憶、帳號本機狀態、桌布、封面快取與中繼資料；備份前會檢查曲庫資料庫，損壞資料會被拒絕。',
  'settings.general.dataBackup.status.enabled': '自動備份已開啟',
  'settings.general.dataBackup.status.disabled': '自動備份未開啟',
  'settings.general.dataBackup.hint.directoryReady': '目錄已設定，可手動備份或開啟定期備份',
  'settings.general.dataBackup.hint.chooseDirectory': '請先選擇備份目錄',
  'settings.general.dataBackup.frequency.aria': '自動備份週期',
  'settings.general.dataBackup.frequency.days': '{days} 天',
  'settings.general.dataBackup.frequency.monthly': '每月',
  'settings.general.dataBackup.meta.directory': '目錄',
  'settings.general.dataBackup.meta.lastBackup': '上次備份',
  'settings.general.dataBackup.meta.nextRun': '下次執行',
  'settings.general.dataBackup.meta.notSet': '未設定',
  'settings.general.dataBackup.meta.noneYet': '暫無自動備份',
  'settings.general.dataBackup.meta.nextRunPending': '選擇目錄並開啟後生效',
  'settings.general.dataBackup.meta.atPath': '{time} · {path}',
  'settings.general.dataBackup.progress.preparing': '準備中',
  'settings.general.dataBackup.progress.snapshot': '建立快照',
  'settings.general.dataBackup.progress.scanning': '掃描資料',
  'settings.general.dataBackup.progress.writing': '寫入備份',
  'settings.general.dataBackup.progress.finalizing': '收尾中',
  'settings.general.dataBackup.progress.completed': '已完成',
  'settings.general.dataBackup.progress.failed': '失敗',
  'settings.general.dataBackup.progress.measuring': '統計中',
  'settings.general.dataBackup.progress.waiting': '等待寫入',
  'settings.general.dataBackup.action.chooseDirectory': '選擇目錄',
  'settings.general.dataBackup.action.choosingDirectory': '選擇中...',
  'settings.general.dataBackup.action.backupNow': '立即備份',
  'settings.general.dataBackup.action.backingUp': '備份中...',
  'settings.general.dataBackup.action.importBackup': '匯入備份',
  'settings.general.dataBackup.action.importingBackup': '匯入中...',
  'settings.general.dataBackup.action.openDirectory': '開啟目錄',
  'settings.general.dataPackage.title': '一鍵匯出 / 遷移 ECHO 資料包',
  'settings.general.dataPackage.description': '匯出設定、曲庫索引、歌單快照、封面快取路徑與帳號狀態說明。不會複製音樂檔案，也不會匯出登入金鑰。',
  'settings.general.dataPackage.action.export': '匯出 ECHO 資料包',
  'settings.general.dataPackage.action.exporting': '打包中...',
  'settings.general.dataPackage.action.recovery': '恢復入口',
  'settings.general.dataPackage.note': '恢復前請先在危險區建立健康快照；遷移包裡的 RESTORE.md 會說明每個檔案的用途。',
  'settings.header.searchPlaceholder': '搜尋設定...',
  'settings.nav.general.label': '一般',
  'settings.nav.general.description': '語言、視窗與基礎行為',
  'settings.nav.playback.label': '播放',
  'settings.nav.playback.description': '輸出、緩衝與播放控制',
  'settings.nav.integrations.label': '連動',
  'settings.nav.remote.label': '網路硬碟 / 遠端',
  'settings.nav.appearance.label': '外觀',
  'settings.nav.library.label': '媒體庫',
  'settings.nav.plugins.label': '外掛',
  'settings.nav.plugins.description': '本機擴充、權限和腳本',
  'settings.plugins.card.title': '本地外掛',
  'settings.plugins.card.description': '外掛預設放在 userData/plugins 下，使用者可以直接編輯 echo.plugin.json、plugin.js 和面板檔案。',
  'settings.plugins.meta.runtime': '執行方式',
  'settings.plugins.meta.runtimeValue': '本地沙箱',
  'settings.plugins.meta.defaultState': '預設狀態',
  'settings.plugins.meta.defaultStateValue': '手動啟用',
  'settings.plugins.meta.permissions': '權限',
  'settings.plugins.meta.permissionsValue': '啟用時確認',
  'settings.plugins.meta.playbackSafety': '播放安全',
  'settings.plugins.meta.playbackSafetyValue': '不進入音訊熱路徑',
  'settings.plugins.action.openPage': '打開外掛頁',
  'settings.plugins.action.openDirectory': '打開外掛目錄',
  'settings.plugins.action.createExample': '新建示例外掛',
  'settings.plugins.action.openDocs': '查看外掛文件',
  'settings.plugins.note': '外掛頁負責啟用、停用、重新載入、命令和日誌；這裡保留入口與安全邊界說明，避免兩套管理 UI 分岔。',
  'settings.nav.about.label': '關於 / 進階',
  'settings.nav.danger.label': '危險操作',
  'settings.eq.action.addFilter': '新增濾波器',
  'settings.eq.action.autoPreamp': '自動 {value}',
  'settings.eq.action.delete': '刪除',
  'settings.eq.action.deleteFilter': '移除濾波器',
  'settings.eq.action.holdBypass': '按住旁路 EQ',
  'settings.eq.action.holdOriginal': '按住聽原聲',
  'settings.eq.action.hideAdvanced': '隱藏 PEQ 控制台',
  'settings.eq.action.importPreset': '匯入預設 / APO',
  'settings.eq.action.exportApoGraphicEqPreset': '匯出 GraphicEQ',
  'settings.eq.action.exportApoPreset': '匯出 APO',
  'settings.eq.action.pasteApoPreset': '貼上 APO',
  'settings.eq.action.resetChannelBalance': '重置聲道平衡',
  'settings.eq.action.resetDelaysOnly': '重置延遲',
  'settings.eq.action.save': '儲存',
  'settings.eq.action.showAdvanced': 'PEQ 控制台',
  'settings.eq.autoGain.adjustment': 'Auto {value}',
  'settings.eq.autoGain.status': '狀態',
  'settings.eq.autoGain.status.clipping': 'Clipping',
  'settings.eq.autoGain.status.holding': 'Holding',
  'settings.eq.autoGain.status.idle': 'Idle',
  'settings.eq.autoGain.status.recovering': 'Recovering',
  'settings.eq.autoGain.status.reducing': 'Reducing',
  'settings.eq.autoGain.toggle': 'Auto Gain',
  'settings.eq.room.active': 'Active',
  'settings.eq.room.channelMode': '聲道',
  'settings.eq.room.clear': '清除',
  'settings.eq.room.disable': '停用 FIR',
  'settings.eq.room.empty': '未載入',
  'settings.eq.room.enable': '啟用 FIR',
  'settings.eq.room.error': '錯誤',
  'settings.eq.room.error.invalidImpulse': 'IR 無效',
  'settings.eq.room.error.invalidWav': 'WAV 無效',
  'settings.eq.room.error.missingFile': 'IR 檔案遺失',
  'settings.eq.room.error.missingIr': '未載入 IR',
  'settings.eq.room.error.tooLong': 'IR 過長',
  'settings.eq.room.import': '匯入 IR',
  'settings.eq.room.ir': 'IR',
  'settings.eq.room.loaded': 'Loaded',
  'settings.eq.room.sampleRate': '取樣率',
  'settings.eq.room.short': 'FIR',
  'settings.eq.room.tapCount': 'Taps',
  'settings.eq.room.title': '房間校正',
  'settings.eq.room.trim': 'Trim',
  'settings.eq.analyzer.overlayAria': 'EQ 即時頻譜疊加',
  'settings.eq.analyzer.input': 'Input',
  'settings.eq.analyzer.mode': '頻譜模式',
  'settings.eq.analyzer.postEq': 'Post EQ',
  'settings.eq.analyzer.status': '狀態',
  'settings.eq.analyzer.status.live': 'Live',
  'settings.eq.analyzer.status.noSignal': 'No signal',
  'settings.eq.analyzer.status.off': 'Off',
  'settings.eq.analyzer.status.priming': 'Priming',
  'settings.eq.analyzer.toggle': '頻譜',
  'settings.eq.band.console': '選中頻段控制台',
  'settings.eq.band.enabledShort': '啟用',
  'settings.eq.band.filters': '濾波器',
  'settings.eq.band.filterStack': 'APO 濾波器鏈',
  'settings.eq.band.gainFixed': '此類型不使用增益',
  'settings.eq.band.qPresets': 'Q 快捷值',
  'settings.eq.band.qPresetWide': 'Wide',
  'settings.eq.band.qPresetNormal': 'Normal',
  'settings.eq.band.qPresetNarrow': 'Narrow',
  'settings.eq.band.matrix': 'PEQ 頻段矩陣',
  'settings.eq.band.modeFree': '自由頻率',
  'settings.eq.band.modeStandard': '標準頻點',
  'settings.eq.bitPerfect.channelDisabled': 'DSP 已啟用：bit-perfect 已關閉。',
  'settings.eq.bitPerfect.disabled': 'DSP 已啟用：bit-perfect 已關閉{reason}。',
  'settings.eq.bitPerfect.readyPath': '可保留 bit-perfect 路徑。',
  'settings.eq.bitPerfect.sourceBoth': 'EQ + 聲道平衡',
  'settings.eq.bitPerfect.sourceChannel': '聲道平衡',
  'settings.eq.bitPerfect.sourceEq': 'EQ',
  'settings.eq.bitPerfect.sourceRoom': '房間校正',
  'settings.eq.channel.active': '啟用',
  'settings.eq.channel.center': '置中',
  'settings.eq.channel.constantPower': '恆定功率',
  'settings.eq.channel.description': 'Balance 用於左右偏移；L/R Gain 校正響度；L/R Delay 校正到達時間；Mono Sum 和 Invert 用於監聽檢查。',
  'settings.eq.channel.group.timing': 'Timing',
  'settings.eq.channel.invertLeft': '左聲道反相',
  'settings.eq.channel.invertRight': '右聲道反相',
  'settings.eq.channel.leftDelay': '左延遲',
  'settings.eq.channel.mono.off': '關閉',
  'settings.eq.channel.mono.sum': '合併',
  'settings.eq.channel.rightDelay': '右延遲',
  'settings.eq.channel.title': '聲道平衡',
  'settings.eq.channel.wizard.apply': '套用測量校準',
  'settings.eq.channel.wizard.clear': '清空測量',
  'settings.eq.channel.wizard.empty': '等待測量',
  'settings.eq.channel.wizard.imageLeft': '聲像偏左',
  'settings.eq.channel.wizard.imageRight': '聲像偏右',
  'settings.eq.channel.wizard.leftDistance': '左距離',
  'settings.eq.channel.wizard.leftLouder': '左邊較響',
  'settings.eq.channel.wizard.leftSpl': '左 SPL',
  'settings.eq.channel.wizard.monitor': '空間校準監聽',
  'settings.eq.channel.wizard.nudge': '空間校準微調',
  'settings.eq.channel.wizard.previewCenter': '中心檢查',
  'settings.eq.channel.wizard.previewLeft': '左檢查',
  'settings.eq.channel.wizard.previewRight': '右檢查',
  'settings.eq.channel.wizard.ready': '可套用',
  'settings.eq.channel.wizard.rightDistance': '右距離',
  'settings.eq.channel.wizard.rightLouder': '右邊較響',
  'settings.eq.channel.wizard.rightSpl': '右 SPL',
  'settings.eq.channel.wizard.title': '空間校準嚮導',
  'settings.eq.comfort.direct': '原聲直通',
  'settings.eq.comfort.directDetail': 'DSP 關閉時不壓低音量、不改動取樣，適合放心聽原聲。',
  'settings.eq.comfort.risk': '需要留意電平',
  'settings.eq.comfort.riskDetail': '偵測到潛在削波或保護動作，建議先預留 -6 dB Headroom。',
  'settings.eq.comfort.tuned': '正在修飾聲音',
  'settings.eq.comfort.tunedDetail': '只處理已啟用的 DSP 模組；關閉後會回到原生播放路徑。',
  'settings.eq.curve.aria': '可拖動 31 段 EQ 頻響曲線',
  'settings.eq.curve.dragBand': '拖動 {frequency} EQ 頻段',
  'settings.eq.filter.highShelf': '高架',
  'settings.eq.filter.highPass': '高通',
  'settings.eq.filter.lowShelf': '低架',
  'settings.eq.filter.lowPass': '低通',
  'settings.eq.filter.notch': '陷波',
  'settings.eq.filter.peaking': '峰值',
  'settings.eq.error.bridgeChannelBalance': '桌面橋接不可用。請在 ECHO Next 桌面端控制聲道平衡。',
  'settings.eq.error.bridgeControlEq': '桌面橋接不可用。請在 ECHO Next 桌面端控制 EQ。',
  'settings.eq.error.bridgeDeletePreset': '桌面橋接不可用。請在 ECHO Next 桌面端刪除 EQ 預設。',
  'settings.eq.error.bridgeSavePreset': '桌面橋接不可用。請在 ECHO Next 桌面端儲存 EQ 預設。',
  'settings.eq.error.presetName': '請輸入預設名稱。',
  'settings.eq.export.successApo': '已匯出 Equalizer APO 設定：{path}',
  'settings.eq.export.successGraphicEq': '已匯出 GraphicEQ 設定：{path}',
  'settings.eq.export.successPreset': '已匯出 EQ 預設：{path}',
  'settings.eq.import.filters': 'Filter',
  'settings.eq.import.filtersValue': '{count} 匯入 / {skipped} 跳過',
  'settings.eq.import.filterPreview': 'Filter 明細',
  'settings.eq.import.filterEnabledAria': '匯入 Filter {index} 啟用狀態',
  'settings.eq.import.filterFrequencyAria': '匯入 Filter {index} 頻率',
  'settings.eq.import.filterGainAria': '匯入 Filter {index} 增益',
  'settings.eq.import.filterQAria': '匯入 Filter {index} Q',
  'settings.eq.import.filterTypeAria': '匯入 Filter {index} 類型',
  'settings.eq.import.estimatedPeak': '預計峰值',
  'settings.eq.import.graphicEq': 'GraphicEQ 點',
  'settings.eq.import.includes': 'Include 檔案',
  'settings.eq.import.includesValue': '{count} 展開 / {skipped} 跳過',
  'settings.eq.import.maxBoost': '最大提升',
  'settings.eq.import.maxCut': '最大削減',
  'settings.eq.import.apoDirectives': 'APO 指令',
  'settings.eq.import.apoDirectiveDetails': '指令明細',
  'settings.eq.import.apoDirectivesValue': '{count} 識別 / {skipped} 聲道 Filter 跳過',
  'settings.eq.import.bandwidthFilters': 'BW 換算',
  'settings.eq.import.bandwidthFiltersValue': '{count} 條轉為 Q',
  'settings.eq.import.compatibility': '相容性',
  'settings.eq.import.compatibility.adjusted': '已換算',
  'settings.eq.import.compatibility.clean': '完整匯入',
  'settings.eq.import.compatibility.partial': '部分匯入',
  'settings.eq.import.moreFilters': '還有 {count} 條 Filter 未顯示',
  'settings.eq.import.noFilters': '沒有需要顯示的有效濾波器。',
  'settings.eq.import.preamp': 'Preamp',
  'settings.eq.import.preampAria': '匯入預設 Preamp',
  'settings.eq.import.safePreamp': '建議餘量',
  'settings.eq.import.safetyDetail': '依目前 Filter 粗略估算，套用前可先留出安全餘量。',
  'settings.eq.import.safetyNeedsHeadroom': '需要安全餘量',
  'settings.eq.import.safetyOk': '餘量看起來安全',
  'settings.eq.import.safetyTitle': '匯入聽感安全',
  'settings.eq.import.audition': '試聽匯入',
  'settings.eq.import.auditionPresetName': '試聽 {name}',
  'settings.eq.import.restoreAudition': '恢復原設定',
  'settings.eq.import.clearPaste': '清空',
  'settings.eq.import.applyPreview': '套用匯入',
  'settings.eq.import.cancelPreview': '取消匯入',
  'settings.eq.import.pasteDefaultName': '貼上的 APO',
  'settings.eq.import.pasteEmpty': '請先貼上 Equalizer APO 設定。',
  'settings.eq.import.pasteFileName': '貼上內容',
  'settings.eq.import.pasteIncludeWarning': '貼上匯入不會讀取 Include 檔案；如需展開 Include，請使用檔案匯入。',
  'settings.eq.import.pasteTitle': 'APO 文字',
  'settings.eq.import.previewPaste': '預覽 APO',
  'settings.eq.import.previewTitle': '匯入預覽',
  'settings.eq.import.reportTitle': '匯入完成',
  'settings.eq.import.source': '來源',
  'settings.eq.import.sourceApo': 'Equalizer APO',
  'settings.eq.import.sourceEcho': 'ECHO JSON',
  'settings.eq.import.updateAudition': '更新試聽',
  'settings.eq.import.useSafePreamp': '使用建議餘量',
  'settings.eq.headphoneCorrection.ab': '耳機校正 A/B',
  'settings.eq.headphoneCorrection.compareCorrected': '校正後',
  'settings.eq.headphoneCorrection.compareOriginal': '對比原聲',
  'settings.eq.headphoneCorrection.convert': '轉為自訂 EQ',
  'settings.eq.headphoneCorrection.customName': '自訂 EQ - {name}',
  'settings.eq.headphoneCorrection.lockAria': '耳機校正 EQ 鎖定提示',
  'settings.eq.headphoneCorrection.lockDetail': '{name} 由耳機校正管理。要手動改參數，先轉為自訂 EQ。',
  'settings.eq.headphoneCorrection.lockedError': '這個 OPRA preset 由耳機校正管理。請先點「轉為自訂 EQ」再修改參數。',
  'settings.eq.headphoneCorrection.managed': '由耳機校正管理',
  'settings.eq.preamp.inputSafety': 'Headroom 管理',
  'settings.eq.preamp.safeHeadroom': '安全餘量',
  'settings.eq.preset.readonly': '內建預設為唯讀。',
  'settings.eq.preset.savePlaceholder': '儲存為使用者預設',
  'settings.eq.status.clippingRisk': '削波風險',
  'settings.eq.status.headroom': '餘量',
  'settings.eq.status.processor': '處理器',
  'settings.eq.status.realtimeIir': '即時 IIR',
  'settings.eq.status.safeHeadroomShort': '安全餘量',
  'settings.eq.signal.armed': '待命',
  'settings.eq.signal.bitPerfectOutput': 'Bit-perfect 路徑',
  'settings.eq.signal.dspActive': 'DSP 訊號鏈已啟用',
  'settings.eq.signal.dspOutput': 'DSP 輸出',
  'settings.eq.signal.input': '輸入',
  'settings.eq.signal.limiter': '保護',
  'settings.eq.signal.output': '輸出',
  'settings.eq.signal.peq': 'PEQ',
  'settings.eq.signal.preamp': '前級',
  'settings.eq.signal.protecting': '保護中',
  'settings.eq.signal.title': '訊號鏈',
  'settings.eq.simpleAction.customPresetName': '我的 EQ 聽感',
  'settings.eq.simpleAction.lastTweak': '上一個調整',
  'settings.eq.simpleAction.nextVibe': '換個聽感',
  'settings.eq.simpleAction.nextVibeDetail': '試試看',
  'settings.eq.simpleAction.savedPresetName': '{name} {amount}%',
  'settings.eq.simpleAction.saveVibe': '儲存聽感',
  'settings.eq.simpleAction.saveVibeDetail': '儲存目前',
  'settings.eq.simpleInsight.amount': '強度',
  'settings.eq.simpleInsight.aria': 'Simple 目前聽感摘要',
  'settings.eq.simpleInsight.custom': '手動聽感',
  'settings.eq.simpleInsight.mainChange': '主要變化',
  'settings.eq.simpleInsight.ready': '就緒',
  'settings.eq.simpleInsight.vibe': '目前聽感',
  'settings.eq.simpleSafety.action': '留出餘量',
  'settings.eq.simpleSafety.aria': 'Simple 安全餘量',
  'settings.eq.simpleSafety.risk': '需要餘量',
  'settings.eq.simpleSafety.riskDetail': '峰值 {peak} / 建議 {preamp}',
  'settings.eq.simpleSafety.safe': '餘量安心',
  'settings.eq.simpleSafety.safeDetail': '峰值 {peak} / 前級 {preamp}',
  'settings.eq.simpleTone.air': '空氣感',
  'settings.eq.simpleTone.airDetail': '更亮更開闊',
  'settings.eq.simpleTone.amount': '味道強度',
  'settings.eq.simpleTone.amountAria': 'Simple 聽感強度',
  'settings.eq.simpleTone.aria': 'Simple 聽感快捷調整',
  'settings.eq.simpleTone.bass': '低頻彈性',
  'settings.eq.simpleTone.bassDetail': '鼓點更飽滿',
  'settings.eq.simpleTone.flat': '恢復平直',
  'settings.eq.simpleTone.flatDetail': '回到原點',
  'settings.eq.simpleTone.less': '淡一點',
  'settings.eq.simpleTone.more': '濃一點',
  'settings.eq.simpleTone.vocal': '人聲靠前',
  'settings.eq.simpleTone.vocalDetail': '歌詞更清楚',
  'settings.eq.simpleTone.warm': '暖一點',
  'settings.eq.simpleTone.warmDetail': '柔和耐聽',
  'settings.eq.simpleZone.air': '空氣感',
  'settings.eq.simpleZone.airDetail': '亮度和空間',
  'settings.eq.simpleZone.applyAria': '套用{zone}聽感，目前{value}',
  'settings.eq.simpleZone.aria': 'Simple 聽感區域變化',
  'settings.eq.simpleZone.low': '低頻',
  'settings.eq.simpleZone.lowDetail': '鼓點和厚度',
  'settings.eq.simpleZone.neutral': '平直',
  'settings.eq.simpleZone.vocal': '人聲',
  'settings.eq.simpleZone.vocalDetail': '歌詞和存在感',
  'settings.eq.routing.action.armHeadroom6': '預設 -6dB 餘量',
  'settings.eq.routing.action.nativeDirect': '原生直通',
  'settings.eq.routing.armed': '已待命',
  'settings.eq.routing.dspPath': 'DSP 路徑',
  'settings.eq.routing.dspPathDetail': '目前處理會明確顯示在鏈路中。',
  'settings.eq.routing.headroomActiveDetail': '餘量正在 DSP 路徑中生效。',
  'settings.eq.routing.headroomStandby': '餘量待命',
  'settings.eq.routing.headroomStandbyDetail': '只會在啟用 DSP 後生效。',
  'settings.eq.routing.modules': '模組',
  'settings.eq.routing.modulesActiveDetail': '下方會顯示每個啟用的處理階段。',
  'settings.eq.routing.modulesBypassed': '已旁路',
  'settings.eq.routing.modulesBypassedDetail': 'EQ / FIR / Balance 均關閉。',
  'settings.eq.routing.nativeBypassComfort': 'DSP 旁路時會保持原生直通，樣本不會被效果鏈改動。',
  'settings.eq.routing.nativeDirect': '原生直通',
  'settings.eq.routing.nativeDirectDetail': 'DSP 旁路時不會改動原生播放。',
  'settings.eq.routing.nativeNoGainDetail': '原生直通下不做增益衰減。',
  'settings.eq.routing.playbackPath': '播放路徑',
  'settings.eq.routing.protectActive': '保護中',
  'settings.eq.routing.protectActiveDetail': 'Limiter 正在防止過載。',
  'settings.eq.routing.safety': '安全',
  'settings.eq.headroom.dsp': 'DSP 餘量',
  'settings.eq.headroom.nativeBypassNote': '僅在 EQ / FIR / Balance 啟用時生效，原生旁路保持直通。',
  'settings.eq.headroom.presetsAria': 'DSP 餘量快捷檔位',  'settings.eq.mode.aria': 'EQ 顯示模式',
  'settings.eq.mode.current': '模式',
  'settings.eq.mode.pro': 'Pro',
  'settings.eq.mode.simple': 'Simple',
  'settings.eq.section.channel': '聲道與監聽工具',
  'settings.eq.section.compare': 'A/B 與旁路對比',
  'settings.eq.subtitle': '聲音曲線、安全餘量與進階調音',
  'settings.eq.title': 'EQ',
  'settings.eq.warning.channelClipping': '存在削波風險：降低增益或前級可獲得更安全的餘量。',
  'settings.eq.warning.lowerPreamp': '降低前級可避免削波。',
  'settings.general.artistInfoSources.description': '選擇重新整理藝人簡介時使用的百科來源；百度百科更適合中文網路環境，Wikipedia 可作為國際藝人備援。',
  'settings.nav.shortcuts.label': '快捷鍵',
  'settings.nav.shortcuts.description': '一般快捷鍵、全域快捷鍵、播放控制',
  'settings.shortcuts.action.clear': '清除',
  'settings.shortcuts.action.bossKey.description': '立即隱藏視窗，並把 ECHO 音量降到 0。',
  'settings.shortcuts.action.bossKey.title': '老闆鍵',
  'settings.shortcuts.action.nextTrack.description': '切到目前播放佇列裡的下一首。',
  'settings.shortcuts.action.nextTrack.title': '下一首',
  'settings.shortcuts.action.openAudioSettings.description': '打開底部播放器的音訊設定抽屜。',
  'settings.shortcuts.action.openAudioSettings.title': '打開音訊設定',
  'settings.shortcuts.action.openLyricsSettings.description': '打開歌詞設定抽屜。',
  'settings.shortcuts.action.openLyricsSettings.title': '打開歌詞設定',
  'settings.shortcuts.action.openMvSettings.description': '打開 MV 設定抽屜。',
  'settings.shortcuts.action.openMvSettings.title': '打開 MV 設定',
  'settings.shortcuts.action.locateCurrentTrack.description': '把目前列表捲動到正在播放的歌曲位置。',
  'settings.shortcuts.action.locateCurrentTrack.title': '定位到目前播放歌曲',
  'settings.shortcuts.action.playPause.description': '在全域範圍切換播放與暫停。',
  'settings.shortcuts.action.playPause.title': '播放 / 暫停',
  'settings.shortcuts.action.previousTrack.description': '切到目前播放佇列裡的上一首。',
  'settings.shortcuts.action.previousTrack.title': '上一首',
  'settings.shortcuts.action.record': '錄製',
  'settings.shortcuts.action.restoreRecommended': '恢復推薦',
  'settings.shortcuts.action.seekBackward.description': '目前歌曲向後退 10 秒。',
  'settings.shortcuts.action.seekBackward.title': '快退 10 秒',
  'settings.shortcuts.action.seekForward.description': '目前歌曲向前進 10 秒。',
  'settings.shortcuts.action.seekForward.title': '快進 10 秒',
  'settings.shortcuts.action.showMainWindow.description': '把 ECHO 主視窗帶回前景。',
  'settings.shortcuts.action.showMainWindow.title': '顯示主視窗',
  'settings.shortcuts.action.speedDown.description': '每次把播放速度降低 0.1x。',
  'settings.shortcuts.action.speedDown.title': '播放減速',
  'settings.shortcuts.action.speedUp.description': '每次把播放速度提高 0.1x。',
  'settings.shortcuts.action.speedUp.title': '播放加速',
  'settings.shortcuts.action.stop.description': '停止目前播放並釋放播放狀態。',
  'settings.shortcuts.action.stop.title': '停止播放',
  'settings.shortcuts.action.toggleDesktopLyrics.description': '打開或關閉桌面歌詞視窗。',
  'settings.shortcuts.action.toggleDesktopLyrics.title': '打開 / 關閉桌面歌詞',
  'settings.shortcuts.action.toggleDesktopLyricsLock.description': '切換桌面歌詞滑鼠穿透鎖定狀態。',
  'settings.shortcuts.action.toggleDesktopLyricsLock.title': '鎖定 / 解鎖歌詞',
  'settings.shortcuts.action.volumeDown.description': '把 ECHO 音量降低 5%。',
  'settings.shortcuts.action.volumeDown.title': '音量降低',
  'settings.shortcuts.action.volumeUp.description': '把 ECHO 音量提高 5%。',
  'settings.shortcuts.action.volumeUp.title': '音量提高',
  'settings.shortcuts.column.function': '功能說明',
  'settings.shortcuts.column.local': '一般快捷鍵',
  'settings.shortcuts.column.global': '全域快捷鍵',
  'settings.shortcuts.description': '一般快捷鍵只有 ECHO 視窗聚焦時生效；全域快捷鍵在背景也生效，啟用前會檢查系統占用。',
  'settings.shortcuts.empty': '未綁定',
  'settings.shortcuts.localUnavailable': '僅全域',
  'settings.shortcuts.message.duplicate': '這個快捷鍵已經綁定到其他動作。',
  'settings.shortcuts.message.empty': '請先錄製一個快捷鍵。',
  'settings.shortcuts.message.invalid': '這個按鍵目前不能作為快捷鍵。',
  'settings.shortcuts.message.safe': '這個快捷鍵可以使用。',
  'settings.shortcuts.message.unavailable': '這個快捷鍵已被系統或其他應用占用，因此保持關閉。',
  'settings.shortcuts.message.unsafe': '這個按鍵目前不能作為快捷鍵；可以讓巨集鍵盤輸出標準鍵盤鍵或媒體鍵。',
  'settings.shortcuts.note': '支援單鍵、組合鍵、媒體鍵、巨集鍵盤鍵與滑鼠側鍵；一般快捷鍵不會在輸入框裡觸發。',
  'settings.shortcuts.recording': '按下新的快捷鍵...',
  'settings.shortcuts.scope.local': '一般快捷鍵',
  'settings.shortcuts.scope.global': '全域快捷鍵',
  'settings.shortcuts.title': '快捷鍵',
  'settings.general.artistInfoSources.title': '藝人資訊來源',
  'settings.general.artistStreamingAlbums.description': '開啟後，藝人詳情的專輯頁會在本地專輯下方按需搜尋並顯示串流專輯；預設關閉，避免增加頁面與網路壓力。',
  'settings.general.artistStreamingAlbums.title': '串流專輯',
  'settings.general.closeToTray': '關閉時隱藏到系統匣',
  'settings.general.sidebarAutoHide.title': '隱藏側邊欄',
  'settings.general.sidebarAutoHide.description': '開啟後側邊欄會收進螢幕邊緣；滑鼠移到左側邊緣時自動抽出。預設關閉。',
  'settings.general.fastStartup.description': '開啟後，啟動時只做輕量唯讀曲庫驗證；完整資料保護快照會在視窗開啟後於背景完成。預設關閉。',
  'settings.general.fastStartup.title': '快速啟動',
  'settings.general.firstRunWizard.description': '開啟後會重新顯示第一次啟動時的向導，可選擇標準輸出（系統音訊）、WASAPI、Exclusive 或 ASIO；完成或略過後會自動關閉這個開關。',
  'settings.general.firstRunWizard.title': '首次啟動指引',
  'settings.general.playerWaveformProgress.description': '開啟後，底部播放列會用輕量波形樣式顯示進度；預設關閉，不解碼音訊也不增加背景分析。',
  'settings.general.playerWaveformProgress.title': '波形進度條',
  'settings.general.homeWaveformVisualizer.description': '控制首頁「今日回聲」的即時波形圖。關閉後不渲染波形，也會跳過首頁波形使用的頻譜分析。',
  'settings.general.homeWaveformVisualizer.title': '首頁波形圖',
  'settings.general.homeRandomHeroTitle.description': '開啟後，首頁標題會從隨機文案池裡抽取，也會混入一點網路梗。關閉後使用固定標題。',
  'settings.general.homeRandomHeroTitle.title': '首頁隨機標題',
  'settings.general.rememberWindowSize.description': '開啟後會記住你上次拖曳後的視窗寬高，下次啟動自動恢復。',
  'settings.general.rememberWindowSize.title': '記住視窗尺寸',
  'settings.general.searchTraditionalVariants.description': '開啟後，輸入繁體可以搜到簡體結果，輸入簡體也可以搜到繁體結果。',
  'settings.general.searchTraditionalVariants.title': '簡繁互搜',
  'settings.general.backup.title': '設定參數備份',
  'settings.general.backup.export': '匯出設定',
  'settings.general.backup.import': '匯入設定',
  'settings.playback.outputMode.asio': 'ASIO',
  'settings.playback.outputMode.description': '普通耳機、藍牙和電腦喇叭建議使用標準輸出。WASAPI / ASIO / Exclusive 適合外接音效卡和 HiFi 調試。',
  'settings.playback.outputMode.exclusive': 'Exclusive',
  'settings.playback.outputMode.shared': 'Shared',
  'settings.playback.outputMode.system': '標準輸出（推薦）',
  'settings.playback.outputMode.title': '輸出模式',
  'settings.playback.advancedPanel.action.collapse': '收起進階播放設定',
  'settings.playback.advancedPanel.action.expand': '展開進階播放設定',
  'settings.playback.advancedPanel.description': '低負載、診斷、JUCE / DSD、匯出和細節播放控制預設收起，避免干擾常用輸出設定。',
  'settings.playback.advancedPanel.memory': '會記住展開狀態',
  'settings.playback.advancedPanel.title': '進階播放設定',
  'settings.playback.asioNativeDsd.description': '預設關閉。僅在 ASIO + 本地 DSF + DoP 開啟且沒有 EQ/音量/變速/DSP 時嘗試；失敗會退回現有 DoP/PCM。',
  'settings.playback.asioNativeDsd.title': 'ASIO 原生 DSD 實驗',
  'settings.playback.dsdDop.description': '預設關閉。本地 DSF 在 ASIO 下嘗試 DoP 直出；失敗會自動退回 FFmpeg PCM，最終以 DAC 顯示為準。',
  'settings.playback.dsdDop.requiresAsio': '需要使用 ASIO',
  'settings.playback.dsdDop.title': 'DSD DoP 直出試驗',
  'settings.playback.exportFormat.description': '底部播放列的匯出按鈕會使用這個格式；匯出速度跟隨目前播放速度。',
  'settings.playback.exportFormat.title': '音訊匯出格式',
  'settings.playback.fixedVolume.description': '開啟後會將 ECHO 音量控制鎖定為 100%；ReplayGain 仍會獨立生效。',
  'settings.playback.fixedVolume.status.fixed': '已固定',
  'settings.playback.fixedVolume.title': '固定音量',
  'settings.playback.gapless.description': '本機同專輯相鄰曲目 0 秒間隔，不淡入淡出；標準輸出會暫時轉入原生 shared 鏈路。Automix 暫停期間保持獨立。',
  'settings.playback.gapless.title': '專輯無縫播放',
  'settings.playback.transportFade.curve.equalPower': '等功率',
  'settings.playback.transportFade.curve.linear': '線性',
  'settings.playback.transportFade.curve.smooth': '平滑',
  'settings.playback.transportFade.description': '拖到 0 ms 關閉；開啟後手動播放 / 暫停使用同一段淡入淡出時長。',
  'settings.playback.transportFade.field.curve': '曲線',
  'settings.playback.transportFade.field.duration': '時長',
  'settings.playback.transportFade.field.fadeIn': '淡入 ms',
  'settings.playback.transportFade.field.fadeOut': '淡出 ms',
  'settings.playback.transportFade.status.disabled': '未開啟',
  'settings.playback.transportFade.status.enabled': '已開啟',
  'settings.playback.transportFade.title': '播放暫停淡入淡出',
  'settings.playback.issueDiagnostics.description': '預設關閉。使用者回報播放異常時開啟，會彈出浮窗記錄狀態、進度、duration、native 緩衝、underrun、backend、警告和 ended 標記。',
  'settings.playback.issueDiagnostics.title': '音訊問題診斷視窗',
  'settings.playback.juceOutput.description': '預設關閉。FFmpeg 相容路徑作為預設輸出；需要時可手動開啟 JUCE 輸出，失敗時自動退回。',
  'settings.playback.juceOutput.title': 'JUCE 主輸出',
  'settings.playback.miniPlayer.action.hide': '隱藏',
  'settings.playback.miniPlayer.action.show': '顯示',
  'settings.playback.miniPlayer.autoHideNote': '開啟迷你播放器時將主介面隱藏到右下角系統匣',
  'settings.playback.miniPlayer.description': '獨立透明置頂小窗，只顯示封面、歌名和進度；視窗會收緊到播放器本體，避免透明空白擋住其他軟體。',
  'settings.playback.miniPlayer.status.hidden': '未顯示',
  'settings.playback.miniPlayer.status.visible': '已顯示',
  'settings.playback.miniPlayer.title': '迷你播放器',
  'settings.playback.monoAudio.description': '把左右聲道合併後同時輸出到兩邊；預設關閉，適合單耳聽、壞聲道耳機或臨時檢查混音。',
  'settings.playback.monoAudio.title': '單聲道音訊',
  'settings.playback.nativeDecode.description': '預設關閉。開啟後，本地 WAV/FLAC/MP3 在不需重取樣時使用長駐原生解碼；MP3 走 Windows Media，失敗會自動退回 FFmpeg。',
  'settings.playback.nativeDecode.title': '長駐原生解碼',
  'settings.playback.hqplayer.defaultBackend.ask': '每次詢問',
  'settings.playback.hqplayer.defaultBackend.echoNative': '繼續使用 ECHO 輸出',
  'settings.playback.hqplayer.defaultBackend.hqplayer': '優先 HQPlayer',
  'settings.playback.hqplayer.description': '預留 HQPlayer 控制端點和播放交接偏好；預設不接管目前播放輸出。',
  'settings.playback.hqplayer.enable': '啟用 HQPlayer 整合',
  'settings.playback.hqplayer.field.defaultBackend': '預設交接',
  'settings.playback.hqplayer.field.endpoint': '控制端點',
  'settings.playback.hqplayer.field.lastChecked': '上次檢測',
  'settings.playback.hqplayer.field.status': '狀態',
  'settings.playback.hqplayer.host': 'Host',
  'settings.playback.hqplayer.mediaServer': 'ECHO 媒體服務',
  'settings.playback.hqplayer.mode.localDesktop': '本機 HQPlayer Desktop',
  'settings.playback.hqplayer.mode.remote': '遠端 HQPlayer',
  'settings.playback.hqplayer.note': '目前只儲存設定並測試 TCP 連通性，不會啟動 HQPlayer，也不會改變 ECHO 目前播放鏈路。',
  'settings.playback.hqplayer.port': '控制連接埠',
  'settings.playback.hqplayer.profileName': '設定檔名稱',
  'settings.playback.hqplayer.result.failed': '連線不可用',
  'settings.playback.hqplayer.result.ok': '連線可用',
  'settings.playback.hqplayer.save': '儲存',
  'settings.playback.hqplayer.saving': '儲存中',
  'settings.playback.hqplayer.status.available': '可用',
  'settings.playback.hqplayer.status.checking': '檢測中',
  'settings.playback.hqplayer.status.disabled': '未啟用',
  'settings.playback.hqplayer.status.notConfigured': '未設定連接埠',
  'settings.playback.hqplayer.status.unavailable': '不可用',
  'settings.playback.hqplayer.test': '測試連線',
  'settings.playback.hqplayer.testing': '測試中',
  'settings.playback.hqplayer.title': 'HQPlayer 整合',
  'settings.playback.speedMode.description': '選擇播放器底部速度滑桿使用的變速方式。',
  'settings.playback.speedMode.title': '變速模式',
  'settings.playback.outputDevice.title': '輸出裝置',
  'settings.playback.outputDevice.empty': '沒有可用裝置',
  'settings.playback.sharedBackend.description': 'DirectSound 只作為手動相容模式，延遲較大；日常播放保持 WASAPI Shared。',
  'settings.playback.sharedBackend.alsa': 'ALSA',
  'settings.playback.sharedBackend.auto': '自動',
  'settings.playback.sharedBackend.directSound': 'DirectSound 相容',
  'settings.playback.sharedBackend.linuxDescription': 'Linux 下預設優先 ALSA；如果系統把 PipeWire 接到 ALSA 相容層，也會走這條共享輸出路徑。',
  'settings.playback.sharedBackend.title': '共享後端',
  'settings.playback.sharedBackend.wasapi': 'WASAPI Shared',
  'settings.playback.resetEngine.action': '重啟音訊引擎',
  'settings.playback.resetEngine.busy': '正在重啟',
  'settings.playback.resetEngine.description': '停止目前播放並釋放 native 音訊主機；裝置或驅動卡住時可先試這個，不必重開軟體。',
  'settings.playback.resetEngine.done': '音訊引擎已重啟，你可以重新開始播放',
  'settings.playback.resetEngine.title': '重啟音訊引擎',
  'settings.playback.segmentLoop.description': '設定目前歌曲的 A/B 點、開啟片段循環，並儲存目前曲目的片段書籤。',
  'settings.playback.segmentLoop.title': 'A-B 循環',
  'settings.playback.replayGain.action.advanced': '進階',
  'settings.playback.replayGain.action.analyzeMissing': '分析缺失音量',
  'settings.playback.replayGain.action.analyzing': '分析中...',
  'settings.playback.replayGain.description': '把不同歌曲的聽感音量拉齊；只讀取標籤或寫入 ECHO 資料庫，不修改你的音樂檔案。',
  'settings.playback.replayGain.error': '音量分析錯誤 {count} 個，已略過問題檔案。',
  'settings.playback.replayGain.field.applied': '目前套用',
  'settings.playback.replayGain.field.mode': '模式',
  'settings.playback.replayGain.field.preventClipping': '防削波',
  'settings.playback.replayGain.field.preamp': '前級增益',
  'settings.playback.replayGain.field.progress': '進度',
  'settings.playback.replayGain.field.target': '目標響度',
  'settings.playback.replayGain.mode.album': '專輯',
  'settings.playback.replayGain.mode.off': '關閉',
  'settings.playback.replayGain.mode.track': '單曲',
  'settings.playback.replayGain.notRun': '尚未執行',
  'settings.playback.replayGain.preset.quiet': '安靜 (-18 LUFS)',
  'settings.playback.replayGain.preset.standard': '標準 (-14 LUFS)',
  'settings.playback.replayGain.status.disabled': '未開啟',
  'settings.playback.replayGain.status.enabled': '已開啟',
  'settings.playback.replayGain.title': '音量標準化',
  'settings.playback.replayGain.toggle.analyzeOnPlay': '播放時分析',
  'settings.playback.replayGain.toggle.analyzeOnScan': '掃描後分析',
  'settings.playback.replayGain.toggle.preventClipping': '防削波',
  'settings.playback.status.off': '關閉',
  'settings.playback.status.on': '開啟',
  'settings.playback.troubleshooting.description': '如果聲音卡住或裝置列表不正常，點這裡。軟重啟不會影響其他應用程式。',
  'settings.playback.troubleshooting.hardAction': '重啟 Windows 音訊服務',
  'settings.playback.troubleshooting.hardBusy': '正在重啟 Windows 音訊服務',
  'settings.playback.troubleshooting.hardConfirm': '這會中斷所有應用程式的聲音（Chrome、遊戲、通話），並需要系統管理員權限。是否繼續？',
  'settings.playback.troubleshooting.hardDone': 'Windows 音訊服務已恢復，你可以重新開始播放',
  'settings.playback.troubleshooting.softAction': '重啟音訊引擎',
  'settings.playback.troubleshooting.softBusy': '正在重啟音訊引擎',
  'settings.playback.troubleshooting.softDone': '音訊引擎已重啟，你可以重新開始播放',
  'settings.playback.troubleshooting.title': '音訊故障排除',
  'settings.playback.wireless.title': '無線播放',
  'settings.playback.audioStatus.title': '音訊狀態',
  'settings.playback.audioStatus.description': '取樣率欄位必須分開顯示，避免舊 ECHO 獨占模式 48k 鎖死回歸。',
  'settings.playback.automix.description': '預設關閉。開啟後，連續佇列會提前準備下一首，並用原生雙 Deck 引擎避開尾端空白、智慧銜接切歌。',
  'settings.playback.automix.title': 'Automix 智慧過渡',
  'settings.playback.stability.action.copied': '已複製',
  'settings.playback.stability.action.copy': '複製診斷資訊',
  'settings.playback.stability.action.refresh': '重新整理播放穩定性診斷',
  'settings.playback.stability.error.desktopBridgeUnavailable': '桌面橋接不可用。',
  'settings.playback.stability.field.lastSharedStabilityRecoveryAt': '上次 Shared 穩定性復原時間',
  'settings.playback.stability.field.lastWatchdogRecoveryTime': '上次 watchdog 復原時間',
  'settings.playback.stability.field.nativeBufferedFrames': 'Native 緩衝影格',
  'settings.playback.stability.field.nativeBufferedMs': 'Native 緩衝毫秒',
  'settings.playback.stability.field.nativeDeviceBufferFrames': '裝置緩衝影格',
  'settings.playback.stability.field.nativeFifoCapacityFrames': 'Native FIFO 容量影格',
  'settings.playback.stability.field.nativeStartupPrebufferFrames': '啟動預緩衝影格',
  'settings.playback.stability.field.nativeUnderrunCallbacks': 'Native underrun 回呼',
  'settings.playback.stability.field.nativeUnderrunFrames': 'Native underrun 影格',
  'settings.playback.stability.field.recentWatchdogRecoveryCount': '近期 watchdog 復原次數',
  'settings.playback.stability.field.sharedStabilityTier': 'Shared 穩定性檔位',
  'settings.playback.stability.field.watchdogStatus': 'watchdog 狀態',
  'settings.playback.stability.title': '播放穩定性診斷',
  'settings.playback.stability.value.unknown': '未知',
  'settings.integrations.discord.action.refresh': '重新整理狀態',
  'settings.integrations.discord.title': 'Discord 狀態',
  'settings.integrations.smtc.description': '把目前播放資訊、封面、進度和媒體鍵動作發布到 Windows 音量浮層與鎖定畫面媒體控制。',
  'settings.integrations.smtc.action.restart': '重新啟動 SMTC',
  'settings.integrations.smtc.action.restarting': '重新啟動中...',
  'settings.integrations.taskbarPlayback.description': '在 Windows 工作列圖示上顯示播放進度，並在懸停縮圖中提供上一首、播放暫停和下一首按鈕。',
  'settings.integrations.taskbarPlayback.title': '工作列音樂控制',
  'settings.integrations.smtc.title': 'Windows 媒體控制',
  'settings.integrations.lastfm.action.completeAuth': '完成授權',
  'settings.integrations.lastfm.action.connect': '連接 Last.fm',
  'settings.integrations.lastfm.action.disconnect': '斷開連接',
  'settings.integrations.lastfm.action.refresh': '重新整理狀態',
  'settings.integrations.lastfm.activeProgress': '{artist} - {title} · {played}/{threshold} 秒',
  'settings.integrations.lastfm.activeTrack': '目前曲目',
  'settings.integrations.lastfm.connection.description': '建議使用瀏覽器授權。在 Last.fm 點 Allow 後，回到 ECHO Next 完成授權。',
  'settings.integrations.lastfm.connection.title': 'Last.fm 連接',
  'settings.integrations.lastfm.description': '在主行程記錄本地播放，不傳送檔案路徑、歌詞或封面。',
  'settings.integrations.lastfm.lastNowPlaying': '上次 Now Playing',
  'settings.integrations.lastfm.lastScrobble': '上次 Scrobble',
  'settings.integrations.lastfm.never': '尚未傳送',
  'settings.integrations.lastfm.noActiveTrack': '沒有活躍曲目',
  'settings.integrations.lastfm.nowPlaying.description': '開始播放時傳送一次目前曲目資訊。',
  'settings.integrations.lastfm.nowPlaying.title': 'Last.fm Now Playing',
  'settings.integrations.lastfm.scrobbling.description': '曲目達到 Last.fm 記錄門檻後提交播放記錄。',
  'settings.integrations.lastfm.scrobbling.title': 'Last.fm Scrobbling',
  'settings.integrations.lastfm.status.connected': '已連接 {username}',
  'settings.integrations.lastfm.status.error': '錯誤：{error}',
  'settings.integrations.lastfm.status.notConnected': '未連接',
  'settings.integrations.lastfm.status.pending': '等待完成授權',
  'settings.integrations.lastfm.statusLabel': '狀態',
  'settings.integrations.lastfm.title': 'Last.fm',
  'settings.integrations.mobile.title': '手機遙控',
  'settings.integrations.mobile.description': '未來外部裝置能力會走受控 IPC，不讓 Renderer 直接連系統資源。',
  'settings.integrations.accounts.cookieFallback': '登入帳號後會自動儲存 Cookie；手動貼上 Cookie 作為備用方式。',
  'settings.integrations.accounts.cookiePlaceholder': '貼上 Cookie 後儲存',
  'settings.integrations.accounts.description.default': '歌詞、中繼資料和下載接入預留。',
  'settings.integrations.accounts.description.bilibili': '用於 MV 解析和高畫質。',
  'settings.integrations.accounts.loginAndSync': '登入並同步',
  'settings.integrations.accounts.clickToLogin': '未登入，點此登入',
  'settings.integrations.accounts.logout': '登出',
  'settings.integrations.accounts.logoutBusy': '登出中...',
  'settings.integrations.accounts.manualSave': '手動儲存',
  'settings.integrations.accounts.manualSaveBusy': '儲存中...',
  'settings.integrations.accounts.check': '檢查',
  'settings.integrations.accounts.checkBusy': '檢查中...',
  'settings.integrations.accounts.loginBusy': '等待登入...',
  'settings.integrations.accounts.loginMeta': '登入 {loginAt} · 檢查 {checkedAt}',
  'settings.integrations.accounts.loginStatus': '登入狀態',
  'settings.integrations.accounts.soundcloudNote': 'SoundCloud 串流播放會使用這裡儲存的登入 Cookie，不需要 Artist Pro 或開發者 API。',
  'settings.integrations.accounts.osuNote': 'osu! 譜面下載會優先使用這裡儲存的登入 Cookie；官方失敗時會自動嘗試 Sayobot、Catboy 和 NeriNyan 鏡像。',
  'settings.integrations.accounts.youtube.browser': '瀏覽器',
  'settings.integrations.accounts.youtube.browserNone': '不使用',
  'settings.integrations.accounts.youtube.description': '沿用系統瀏覽器登入邏輯，供後續解析/下載使用。',
  'settings.integrations.accounts.youtube.savedStatus': '選擇瀏覽器後會儲存系統瀏覽器登入狀態。',
  'settings.integrations.accounts.spotify.description': '官方播放器接入，需要 Premium；請先在上方填寫自己的 Spotify Client ID，並在 Spotify Dashboard 註冊回調地址。',
  'settings.integrations.accounts.spotify.login': '登入 Spotify',
  'settings.integrations.accounts.spotify.loginBusy': '等待授權...',
  'settings.integrations.accounts.spotify.savedStatus': '使用 OAuth PKCE 授權，不儲存 Client Secret；下載功能不適用於 Spotify。',
  'settings.integrations.accountPanel.title': '帳號登入',
  'settings.integrations.accountPanel.description': '儲存平台登入狀態，供後續歌詞、中繼資料、MV、下載和串流媒體接入使用。Cookie 會在登入帳號後自動儲存。',
  'settings.integrations.accountPanel.refreshAll': '全部重新整理',
  'settings.integrations.accountStartupRefresh.title': '啟動時重新整理帳號登入狀態',
  'settings.integrations.accountStartupRefresh.description': '只檢查以前登入過的帳號，從未登入過的平台會保持靜默。',
  'settings.integrations.accountExpiryNotices.title': '關閉帳號失效通知',
  'settings.integrations.accountExpiryNotices.description': '開啟後，帳號失效時不再彈出左上角提醒；帳號狀態仍可在這裡查看。',
  'settings.integrations.credentialPanel.title': '開發者 / API 設定',
  'settings.integrations.credentialPanel.description': 'Spotify、TIDAL、Discogs、線上歌手與 Last.fm；用不到時可以保持收起。',
  'settings.integrations.credentialPanel.expand': '展開 API 設定',
  'settings.integrations.credentialPanel.collapse': '收起 API 設定',
  'settings.integrations.smtcLyrics.title': 'SMTC 歌詞顯示',
  'settings.integrations.smtcLyrics.description': '允許把目前歌詞行附加到 Windows 媒體資訊裡；預設關閉，避免污染歌手欄位。',
  'settings.integrations.spotifyAutoLaunchOfficialPlayer.title': 'Spotify 自動啟動官方播放器',
  'settings.integrations.spotifyAutoLaunchOfficialPlayer.description': '播放 Spotify 時，如果 ECHO 內建 SDK 因 DRM 不可用，會自動打開 Spotify 桌面端或網頁版並接管 Connect 裝置。',
  'settings.integrations.networkProxy.title': '網路代理',
  'settings.integrations.networkProxy.description': '給登入頁、網路封面、歌詞、MV 搜尋和中繼資料補全使用。媒體播放流預設不走代理，避免影響緩衝和 Range 請求。',
  'settings.integrations.networkProxy.mode': '模式',
  'settings.integrations.networkProxy.modeAria': '網路代理模式',
  'settings.integrations.networkProxy.mode.off': '關閉',
  'settings.integrations.networkProxy.mode.system': '系統代理',
  'settings.integrations.networkProxy.mode.manual': '手動代理',
  'settings.integrations.networkProxy.manualUrl': '手動代理位址',
  'settings.integrations.networkProxy.manualPlaceholder': 'http://127.0.0.1:7890 或 socks5://127.0.0.1:7890',
  'settings.integrations.networkProxy.pacUrl': 'PAC 位址',
  'settings.integrations.networkProxy.bypass': '略過位址',
  'settings.integrations.networkProxy.save': '儲存並套用',
  'settings.integrations.networkProxy.saveBusy': '儲存中...',
  'settings.integrations.networkProxy.test': '測試連線',
  'settings.integrations.networkProxy.testBusy': '測試中...',
  'settings.integrations.networkProxy.note': '第一版只預設代理一般聯網能力；遠端曲庫和播放位元組流保持直連，避免影響正在播放的穩定性。',
  'settings.remote.hero.title': '網路硬碟 / 遠端音樂庫',
  'settings.remote.hero.summary': '網路硬碟 / WebDAV / AList / NAS / Subsonic / Jellyfin / Emby',
  'settings.remote.hero.description': '可連接 AList、堅果雲、Nextcloud 等 WebDAV 網路硬碟，也能把 Jellyfin、Emby、Navidrome、NAS 或 SSHFS 當成獨立音樂來源瀏覽。ECHO 會為遠端歌曲建立本地索引，讓歌詞、MV、播放進度、收藏與歷史記錄正常運作。',
  'settings.remote.guardrail.aria': '遠端庫同步邊界',
  'settings.remote.guardrail.title': '本地播放優先',
  'settings.remote.guardrail.description': '遠端同步與封面/中繼資料補齊都會在背景限速執行；播放活躍時會降低並發。當前離線邊界是索引、封面和小型中繼資料快取，不會靜默鏡像整個音樂庫檔案。',
  'settings.remote.coverPerformance.aria': '遠端封面載入性能',
  'settings.remote.coverPerformance.title': '載入性能',
  'settings.remote.coverPerformance.description': '控制遠端封面預熱強度；只影響清單封面載入，不會改變播放取流。',
  'settings.remote.coverPerformance.groupAria': '遠端封面載入性能檔位',
  'settings.remote.coverPerformance.option.low': '省流量',
  'settings.remote.coverPerformance.option.low.description': '只預熱目前可見封面，適合公網或較弱的伺服器。',
  'settings.remote.coverPerformance.option.balanced': '均衡',
  'settings.remote.coverPerformance.option.balanced.description': '預熱目前與後方約半屏到一屏的封面，預設推薦。',
  'settings.remote.coverPerformance.option.aggressive': '積極預熱',
  'settings.remote.coverPerformance.option.aggressive.description': '滾動停頓時提前拉取更多封面，適合區域網內的 Navidrome。',
  'settings.remote.coverPerformance.option.lan': '區域網極速',
  'settings.remote.coverPerformance.option.lan.description': '把遠端封面預熱與背景載入並發拉滿，適合本機、NAS 或穩定的千兆區域網。',
  'settings.remote.albumMerge.aria': '遠端專輯合併策略',
  'settings.remote.albumMerge.title': '專輯合併',
  'settings.remote.albumMerge.description': '只影響網路硬碟 / 遠端專輯列表的展示分組；不改本地庫、不改檔案標籤、不影響播放。',
  'settings.remote.albumMerge.groupAria': '遠端專輯合併檔位',
  'settings.remote.albumMerge.option.conservative': '保守合併',
  'settings.remote.albumMerge.option.conservative.description': '優先使用伺服器專輯 ID；一般網路硬碟只合併同來源、同資料夾、同專輯的曲目。',
  'settings.remote.albumMerge.option.standard': '一般合併',
  'settings.remote.albumMerge.option.standard.description': '在保守邊界上放寬標題差異，會合併大小寫、符號與 - Single 這類遠端專輯拆分。',
  'settings.remote.albumMerge.stat.current': '原專輯數量',
  'settings.remote.albumMerge.stat.target': '合併後數量',
  'settings.remote.albumMerge.stat.tracks': '已索引遠端歌曲',
  'settings.remote.albumMerge.pending': '待掃描',
  'settings.remote.albumMerge.action.scan': '掃描遠端曲庫',
  'settings.remote.albumMerge.action.scanning': '掃描中...',
  'settings.remote.albumMerge.action.apply': '套用並重新整理分組',
  'settings.remote.albumMerge.action.applying': '重新整理中...',
  'settings.remote.library.title': '遠端音樂庫',
  'settings.remote.library.description': '本階段禁止網路硬碟 / 遠端 / 串流，只保留設定分組佔位。',
  'segmentLoop.action.clear': '清除目前 A-B 點',
  'segmentLoop.action.deleteBookmark': '刪除片段書籤 {label}',
  'segmentLoop.action.deleteBookmarkTitle': '刪除片段書籤',
  'segmentLoop.action.loopBookmark': '循環片段 {label}',
  'segmentLoop.action.loopBookmarkTitle': '循環 {label}',
  'segmentLoop.action.saveBookmark': '儲存目前片段書籤',
  'segmentLoop.action.setA': '把目前位置設為 A 點',
  'segmentLoop.action.setB': '把目前位置設為 B 點',
  'segmentLoop.action.toggle': '切換 A-B 循環',
  'segmentLoop.action.toggleTitle': '開啟或關閉 A-B 循環',
  'segmentLoop.aria.bookmarks': '目前曲目的片段書籤',
  'segmentLoop.aria.panel': 'A-B 循環和片段書籤',
  'segmentLoop.empty': '儲存片段後會顯示在這裡',
  'segmentLoop.notSet': '未設定',
  'spotifyPlayback.error.noDevice': '沒有可用的 Spotify 播放裝置。請開啟「自動啟動官方播放器」，或先打開 Spotify 桌面端/網頁版。{hint}',
  'spotifyPlayback.error.noDrmKeysystem': '目前 Electron 建置沒有可用的 DRM/Widevine keysystem，Spotify 官方播放器無法在 ECHO 內註冊裝置。',
  'settings.eq.ab.summary': '{preset} / 峰值 {peak} / 輸出 {output} / 前級 {preamp}',
  'settings.eq.level.clips': '削波 {count}',
  'settings.eq.level.estimatedOutputPeak': '估算輸出峰值',
  'settings.eq.level.headroom': '餘量',
  'settings.eq.level.inputPeak': '輸入峰值',
  'settings.eq.level.inputRms': '輸入 RMS',
  'settings.eq.level.sourceEstimate': 'pre-native + DSP 估算',
  'settings.appearance.theme.title': '主題',
  'settings.appearance.theme.description': '選擇淺色、深色，或跟隨系統外觀。',
  'settings.appearance.theme.light': '淺色',
  'settings.appearance.theme.dark': '深色',
  'settings.appearance.theme.followSystem': '跟隨系統',
  'settings.appearance.themeSchedule.title': '定時切換深色模式',
  'settings.appearance.themeSchedule.description': '依照系統時間，到點自動切到深色，再按設定時間切回淺色。',
  'settings.appearance.themeSchedule.toggle': '啟用定時',
  'settings.appearance.themeSchedule.toggleAria': '啟用定時切換深色模式',
  'settings.appearance.themeSchedule.darkAt': '切到深色',
  'settings.appearance.themeSchedule.lightAt': '切回淺色',
  'settings.appearance.themeSchedule.status.enabled': '已啟用：{darkAt} 切到{mode}，{lightAt} 自動切回淺色。目前依本機時間使用{mode}。',
  'settings.appearance.themeSchedule.status.disabled': '關閉後仍使用上面的手動主題模式。',
  'settings.appearance.sidebar.title': '側邊欄',
  'settings.appearance.sidebar.description': '調整側邊入口的順序與顯示狀態，不會改動頁面或播放鏈路。',
  'settings.appearance.sidebar.expand': '展開側邊欄佈局',
  'settings.appearance.sidebar.collapse': '收起側邊欄佈局',
  'settings.appearance.sidebar.mainGroup': '主導覽',
  'settings.appearance.sidebar.utilityGroup': '底部入口',
  'settings.appearance.sidebar.reset': '恢復預設',
  'settings.appearance.sidebar.visible': '顯示',
  'settings.appearance.sidebar.hidden': '隱藏',
  'settings.appearance.sidebar.fixed': '固定顯示',
  'settings.appearance.sidebar.noItems': '這一組沒有可調整的入口。',
  'settings.appearance.sidebar.summary.allVisible': '全部顯示',
  'settings.appearance.sidebar.summary.hidden': '已隱藏 {count} 個入口',
  'settings.appearance.sidebar.count': '{count} 項',
  'settings.appearance.sidebar.moveUp': '上移',
  'settings.appearance.sidebar.moveDown': '下移',
  'settings.appearance.sidebar.moveUpAria': '上移 {label}',
  'settings.appearance.sidebar.moveDownAria': '下移 {label}',
  'settings.appearance.sidebar.hideAria': '隱藏 {label}',
  'settings.appearance.sidebar.showAria': '顯示 {label}',
  'settings.appearance.nowPlayingCoverColor.title': '播放介面封面取色',
  'settings.appearance.nowPlayingCoverColor.description': '開啟後，正在播放頁會在閒置時從小封面取樣生成輕量背景；低負載模式會自動略過。預設關閉。',
  'settings.appearance.albumCoverShape.title': '專輯封面形狀',
  'settings.appearance.albumCoverShape.description': '選擇專輯封面顯示為圓角或方角；此設定優先於主題預設。預設圓角。',
  'settings.appearance.albumCoverShape.rounded': '圓角',
  'settings.appearance.albumCoverShape.square': '方角',
  'settings.appearance.wallpaper.title': '自訂背景',
  'settings.appearance.wallpaper.description': '橫向與直向背景會分開儲存；直向視窗只會套用直向背景。支援圖片與本地影片。',
  'settings.appearance.wallpaper.choose': '選擇橫向背景',
  'settings.appearance.wallpaper.clear': '清除橫向背景',
  'settings.appearance.wallpaper.portraitChoose': '選擇直向背景',
  'settings.appearance.wallpaper.portraitClear': '清除直向背景',
  'settings.appearance.wallpaper.landscapePath': '橫向',
  'settings.appearance.wallpaper.portraitPath': '直向',
  'settings.appearance.wallpaper.videoStatus': '影片桌布 · 靜音循環',
  'settings.appearance.wallpaper.videoPause.smart': '智慧暫停',
  'settings.appearance.wallpaper.videoPause.minimized': '最小化暫停',
  'settings.appearance.wallpaper.videoPause.never': '持續播放',
  'settings.appearance.wallpaper.scale': '桌布縮放',
  'settings.appearance.wallpaper.blur': '桌布模糊度',
  'settings.appearance.wallpaper.brightness': '桌布亮度',
  'settings.appearance.wallpaper.uiOpacity': 'UI 透明度',
  'settings.appearance.wallpaper.visualProtection': '可視化保護',
  'settings.appearance.wallpaper.unifiedOpacity': '統一透明度',
  'settings.appearance.themePreset.title': '主題預設',
  'settings.appearance.themePreset.description': '選擇一套全域漸層色板；目前的明暗模式仍會保留。',
  'settings.appearance.themePreset.classic': '經典 ECHO Next',
  'settings.appearance.themePreset.classic.description': '白灰基底、克制藍紫強調，接近 Roon 的乾淨耐看。',
  'settings.appearance.themePreset.echoTwilight': '暮光桃霧',
  'settings.appearance.themePreset.echoTwilight.description': '老版 ECHO 的暖粉漸層感。',
  'settings.appearance.themePreset.sakuraMilk': '櫻粉奶霜',
  'settings.appearance.themePreset.sakuraMilk.description': '奶白粉底配櫻桃紅強調。',
  'settings.appearance.themePreset.peachSoda': '蜜桃蘇打',
  'settings.appearance.themePreset.peachSoda.description': '蜜桃橙和蘇打青的輕快組合。',
  'settings.appearance.themePreset.mintCandy': '薄荷軟糖',
  'settings.appearance.themePreset.mintCandy.description': '薄荷綠、奶油白和一點桃粉。',
  'settings.appearance.themePreset.berryDream': '藍莓星糖',
  'settings.appearance.themePreset.berryDream.description': '莓紫雲白，帶一點夢幻粉光。',
  'settings.appearance.themePreset.matchaCream': '抹茶奶油',
  'settings.appearance.themePreset.matchaCream.description': '抹茶綠和奶油黃，更安靜耐看。',
  'settings.appearance.themePreset.lemonMochi': '檸檬麻糬',
  'settings.appearance.themePreset.lemonMochi.description': '奶黃和天藍，像柔軟的檸檬點心。',
  'settings.appearance.themePreset.cottonCloud': '棉花雲朵',
  'settings.appearance.themePreset.cottonCloud.description': '雲白藍配柔粉，明亮但不刺眼。',
  'settings.appearance.themePreset.melonCream': '哈密瓜奶霜',
  'settings.appearance.themePreset.melonCream.description': '蜜瓜綠與奶油底，清甜且易讀。',
  'settings.appearance.themePreset.seaSaltJelly': '海鹽果凍',
  'settings.appearance.themePreset.seaSaltJelly.description': '海鹽青配蜜桃光，清透但壓得住文字。',
  'settings.appearance.themePreset.caramelPudding': '焦糖布丁',
  'settings.appearance.themePreset.caramelPudding.description': '奶油焦糖配草莓光，甜但不膩。',
  'settings.appearance.themePreset.neonCandy': '霓虹糖果',
  'settings.appearance.themePreset.neonCandy.description': '紫色霓虹、粉色高光和薄荷泡泡。',
  'settings.appearance.themePreset.nyanCat': 'Nyan Cat',
  'settings.appearance.themePreset.nyanCat.description': '慢速流動的可愛彩虹漸層，進度條會帶著彩虹貓一起跑。',
  'settings.appearance.themePreset.childrenDoodle': '六一塗鴉',
  'settings.appearance.themePreset.childrenDoodle.description': '紙紋、蠟筆邊框和亂塗貼紙，像兒童節手帳一樣熱鬧。',
  'settings.appearance.themePreset.wisteriaBubble': '紫藤泡泡',
  'settings.appearance.themePreset.wisteriaBubble.description': '紫藤花霧配薄荷泡泡，夢幻但清爽。',
  'settings.appearance.themePreset.strawberryCookie': '草莓餅乾',
  'settings.appearance.themePreset.strawberryCookie.description': '奶油餅乾底配草莓紅和烘焙金。',
  'settings.appearance.themePreset.graphiteAurora': '石墨極光',
  'settings.appearance.themePreset.graphiteAurora.description': '石墨灰裡帶一點青綠極光，冷靜但有層次。',
  'settings.appearance.themePreset.amberNoir': '琥珀夜色',
  'settings.appearance.themePreset.amberNoir.description': '黑金唱片廳感，適合暗色長聽。',
  'settings.appearance.themePreset.oceanStudio': '海岸錄音室',
  'settings.appearance.themePreset.oceanStudio.description': '冷藍灰和海霧藍，乾淨專業。',
  'settings.appearance.themePreset.rosewoodVinyl': '玫瑰木黑膠',
  'settings.appearance.themePreset.rosewoodVinyl.description': '木質暖紅與黑膠暗調，更沉穩復古。',
  'settings.appearance.themePreset.darkSideMoon': 'The Dark Side of the Moon',
  'settings.appearance.themePreset.darkSideMoon.description': '致敬 Pink Floyd：黑月、白色稜鏡與彩虹光譜。',
  'settings.appearance.themePreset.shibuyaNight': '澀谷夜色',
  'settings.appearance.themePreset.shibuyaNight.description': '東京霓虹、夜紫街口和青色招牌光。',
  'settings.appearance.themePreset.kyotoKurenai': '京都朱印',
  'settings.appearance.themePreset.kyotoKurenai.description': '鳥居朱紅、和紙暖底和御守金色。',
  'settings.appearance.themePreset.ukiyoIndigo': '浮世靛藍',
  'settings.appearance.themePreset.ukiyoIndigo.description': '浮世繪海浪的靛藍、紙色和古金。',
  'settings.appearance.themePreset.fujiSnow': '富士初雪',
  'settings.appearance.themePreset.fujiSnow.description': '雪白、富士藍與淡櫻高光，清澈冷甜。',
  'settings.appearance.themePreset.matsuriLantern': '祭燈金魚',
  'settings.appearance.themePreset.matsuriLantern.description': '夏祭燈籠紅、夜市金光和溫暖紙色。',
  'settings.appearance.themePreset.ginzaNoir': '銀座黑曜',
  'settings.appearance.themePreset.ginzaNoir.description': '黑曜石、香檳金和櫥窗藍，成熟一點。',
  'settings.appearance.themePreset.frostJazz': '霜林爵士',
  'settings.appearance.themePreset.frostJazz.description': '冷藍爵士底色，帶一抹梅紫舞台光。',
  'settings.appearance.themePreset.FINAL': 'FINAL',
  'settings.appearance.themePreset.FINAL.description': '參考 final 官網的黑白產品攝影、聲學工程與 8K SOUND 語言，克制、精密、偏監聽。',
  'settings.appearance.themeCustom.title': '自訂目前主題',
  'settings.appearance.themeCustom.description': '先選一個主題，再微調顏色；每個主題都會記住自己的自訂。',
  'settings.appearance.themeCustom.action.autoFix': '自動修正文字',
  'settings.appearance.themeCustom.action.create': '新建我的主題',
  'settings.appearance.themeCustom.action.rename': '重新命名',
  'settings.appearance.themeCustom.action.duplicate': '複製',
  'settings.appearance.themeCustom.action.delete': '刪除',
  'settings.appearance.themeCustom.action.copyLightToDark': '複製淺色到深色',
  'settings.appearance.themeCustom.action.copyDarkToLight': '複製深色到淺色',
  'settings.appearance.themeCustom.action.export': '匯出參數',
  'settings.appearance.themeCustom.action.import': '匯入參數',
  'settings.appearance.themeCustom.action.reset': '重置目前自訂',
  'settings.appearance.themeCustom.action.save': '儲存自訂',
  'settings.appearance.themeCustom.expand': '展開我的主題',
  'settings.appearance.themeCustom.collapse': '收起我的主題',
  'settings.appearance.themeCustom.advanced.show': '展開進階設定',
  'settings.appearance.themeCustom.advanced.hide': '收起進階設定',
  'settings.appearance.themeCustom.field.appBg': '底色',
  'settings.appearance.themeCustom.field.appBg2': '漸層中段',
  'settings.appearance.themeCustom.field.appBg3': '漸層尾色',
  'settings.appearance.themeCustom.field.panel': '玻璃色調',
  'settings.appearance.themeCustom.field.panelSoft': '柔面板',
  'settings.appearance.themeCustom.field.accent': '主強調色',
  'settings.appearance.themeCustom.field.accentStrong': '次強調色',
  'settings.appearance.themeCustom.field.secondary': '第三強調色',
  'settings.appearance.themeCustom.field.heading': '主文字',
  'settings.appearance.themeCustom.field.text': '正文文字',
  'settings.appearance.themeCustom.field.muted': '次要文字',
  'settings.appearance.themeCustom.field.border': '邊界色',
  'settings.appearance.themeCustom.field.onAccent': '強調按鈕文字',
  'settings.appearance.themeCustom.field.buttonText': '一般按鈕文字',
  'settings.appearance.themeCustom.field.panelOpacity': '面板透明度',
  'settings.appearance.themeCustom.field.glass': '玻璃感',
  'settings.appearance.themeCustom.field.shadow': '陰影強度',
  'settings.appearance.themeCustom.field.titlebar': '標題列',
  'settings.appearance.themeCustom.field.sidebar': '側欄',
  'settings.appearance.themeCustom.field.player': '播放器',
  'settings.appearance.themeCustom.field.field': '輸入框',
  'settings.appearance.themeCustom.field.row': '列表列',
  'settings.appearance.themeCustom.field.rowHover': '懸停列',
  'settings.appearance.themeCustom.field.rowActive': '選中列',
  'settings.appearance.themeCustom.field.chip': '晶片',
  'settings.appearance.themeCustom.field.focus': '焦點環',
  'settings.appearance.themeCustom.field.success': '成功色',
  'settings.appearance.themeCustom.field.warning': '警告色',
  'settings.appearance.themeCustom.field.danger': '危險色',
  'settings.appearance.themeCustom.field.cornerRadius': '圓角',
  'settings.appearance.themeCustom.field.panelBlur': '面板模糊',
  'settings.appearance.themeCustom.field.saturation': '飽和度',
  'settings.appearance.themeCustom.field.motionEnabled': '啟用動效',
  'settings.appearance.themeCustom.field.motionSpeed': '動效速度',
  'settings.appearance.themeCustom.field.motionIntensity': '動效強度',
  'settings.appearance.themeCustom.field.appBg.description': '主視窗底色',
  'settings.appearance.themeCustom.field.appBg2.description': '背景漸層的柔光中段',
  'settings.appearance.themeCustom.field.appBg3.description': '背景漸層的末端停靠色',
  'settings.appearance.themeCustom.field.panel.description': '面板磨砂著色',
  'settings.appearance.themeCustom.field.panelSoft.description': '側欄和弱層級面板',
  'settings.appearance.themeCustom.field.accent.description': '主要互動',
  'settings.appearance.themeCustom.field.accentStrong.description': '漸層與層次',
  'settings.appearance.themeCustom.field.secondary.description': '高光點綴',
  'settings.appearance.themeCustom.field.heading.description': '標題與主文案',
  'settings.appearance.themeCustom.field.text.description': '正文、歌手和設定文案',
  'settings.appearance.themeCustom.field.muted.description': '輔助說明',
  'settings.appearance.themeCustom.field.border.description': '卡片邊框和分隔線',
  'settings.appearance.themeCustom.field.onAccent.description': '強調按鈕上的文字',
  'settings.appearance.themeCustom.field.buttonText.description': '一般按鈕和晶片文字',
  'settings.appearance.themeCustom.field.panelOpacity.description': '面板露出背景的程度',
  'settings.appearance.themeCustom.field.glass.description': '背景模糊和玻璃層次',
  'settings.appearance.themeCustom.field.shadow.description': '卡片、彈窗和播放器投影',
  'settings.appearance.themeCustom.field.titlebar.description': '視窗頂部列背景',
  'settings.appearance.themeCustom.field.sidebar.description': '左側導覽和弱層級區域',
  'settings.appearance.themeCustom.field.player.description': '底部播放器背景',
  'settings.appearance.themeCustom.field.field.description': '輸入框和搜尋框底色',
  'settings.appearance.themeCustom.field.row.description': '列表普通列背景',
  'settings.appearance.themeCustom.field.rowHover.description': '滑鼠懸停列背景',
  'settings.appearance.themeCustom.field.rowActive.description': '目前選中列背景',
  'settings.appearance.themeCustom.field.chip.description': '篩選晶片和小按鈕底色',
  'settings.appearance.themeCustom.field.focus.description': '鍵盤焦點和描邊高亮',
  'settings.appearance.themeCustom.field.success.description': '成功狀態提示',
  'settings.appearance.themeCustom.field.warning.description': '警告狀態提示',
  'settings.appearance.themeCustom.field.danger.description': '危險操作提示',
  'settings.appearance.themeCustom.field.cornerRadius.description': '面板和按鈕圓角大小',
  'settings.appearance.themeCustom.field.panelBlur.description': '玻璃面板模糊半徑',
  'settings.appearance.themeCustom.field.saturation.description': '介面整體色彩濃度',
  'settings.appearance.themeCustom.field.motionEnabled.description': '只影響 CSS 過渡變數',
  'settings.appearance.themeCustom.field.motionSpeed.description': 'CSS 動效時長',
  'settings.appearance.themeCustom.field.motionIntensity.description': 'CSS 位移和強調強度',
  'settings.appearance.themeCustom.preview.title': '正在編輯',
  'settings.appearance.themeCustom.preview.description': '改動會先即時預覽，儲存後才寫入設定。',
  'settings.appearance.themeCustom.myThemes.title': '我的主題',
  'settings.appearance.themeCustom.myThemes.description': '另存、切換、複製、匯入匯出安全主題參數。',
  'settings.appearance.themeCustom.myThemes.empty': '還沒有自訂主題。',
  'settings.appearance.themeCustom.group.core': '常用顏色',
  'settings.appearance.themeCustom.group.core.description': '老 ECHO 式主色板，改這裡最直觀。',
  'settings.appearance.themeCustom.group.gradient': '背景漸層',
  'settings.appearance.themeCustom.group.gradient.description': '控制老 ECHO 那種視窗底色漸層氛圍。',
  'settings.appearance.themeCustom.group.surface': '表面',
  'settings.appearance.themeCustom.group.surface.description': '標題列、側欄、播放器和列表層級。',
  'settings.appearance.themeCustom.group.state': '狀態',
  'settings.appearance.themeCustom.group.state.description': '成功、警告、危險和焦點色。',
  'settings.appearance.themeCustom.group.motion': '動效',
  'settings.appearance.themeCustom.group.motion.description': '僅寫入 CSS 變數，不增加執行時計時器。',
  'settings.appearance.themeCustom.group.advanced': '進階細節',
  'settings.appearance.themeCustom.group.advanced.description': '更細的文字、邊界和按鈕文字顏色。',
  'settings.appearance.themeCustom.message.created': '已新建我的主題。',
  'settings.appearance.themeCustom.message.copied': '已複製到目標色調，儲存後生效。',
  'settings.appearance.themeCustom.message.exported': '已匯出目前主題參數。',
  'settings.appearance.themeCustom.message.imported': '已匯入主題參數並套用。',
  'settings.appearance.themeCustom.message.importFailed': '匯入失敗，請選擇 ECHO 主題參數 JSON。',
  'settings.appearance.themeCustom.message.fixed': '已自動調整文字與按鈕顏色。',
  'settings.appearance.themeCustom.message.invalidColor': '請輸入 #RRGGBB 格式的安全顏色。',
  'settings.appearance.themeCustom.message.lowContrast': '目前文字對比不足，可能影響閱讀。可自動修正或手動調整文字顏色。',
  'settings.appearance.themeCustom.message.reset': '已重置目前主題的自訂。',
  'settings.appearance.themeCustom.message.saved': '已儲存目前主題自訂。',
  'settings.appearance.density.title': '介面密度',
  'settings.appearance.density.compact': '緊湊',
  'settings.appearance.density.standard': '標準',
  'settings.appearance.artistAvatars.action.clear': '清除頭像快取',
  'settings.appearance.artistAvatars.action.queueing': '加入佇列中...',
  'settings.appearance.artistAvatars.action.refreshMissing': '重新整理缺失頭像',
  'settings.appearance.artistAvatars.description': '在背景慢速取得真實歌手頭像，並在藝術家牆重複使用本機快取圖片。',
  'settings.appearance.artistAvatars.fallback': '搜尋不到時使用藝術家的專輯封面',
  'settings.appearance.artistAvatars.message.cleared': '已清除 {removedRows} 筆頭像記錄和 {deletedFiles} 個檔案。',
  'settings.appearance.artistAvatars.message.desktopBridgeClear': '桌面橋接不可用。請在 Electron 中開啟 ECHO Next 以清除歌手頭像。',
  'settings.appearance.artistAvatars.message.desktopBridgeRefresh': '桌面橋接不可用。請在 Electron 中開啟 ECHO Next 以重新整理歌手頭像。',
  'settings.appearance.artistAvatars.message.enableFirst': '請先開啟自動取得歌手頭像。',
  'settings.appearance.artistAvatars.message.queued': '已加入 {queued} 個歌手頭像。略過 {skipped} 個。',
  'settings.appearance.artistAvatars.title': '歌手頭像',
  'settings.appearance.artistAvatars.toggle': '自動取得歌手頭像',
  'settings.devices.title': '裝置列表',
  'settings.devices.empty': 'echo-audio-host 暫未回傳輸出裝置。',
  'settings.danger.database.kicker': '曲庫資料庫安全',
  'settings.danger.database.title': '恢復助手',
  'settings.danger.database.badge.quarantined': '已隔離',
  'settings.danger.database.description.loading': '正在讀取資料庫健康狀態、健康快照與最近維護記錄。',
  'settings.danger.database.description.quarantined': '曲庫因損壞嵌入標籤或超大文字已被隔離。ECHO 會先打開恢復介面，音樂檔案不會被刪除。',
  'settings.danger.database.description.healthy': '目前資料庫檢查正常。這裡會保留健康快照、壞庫歸檔與最近維護記錄。',
  'settings.danger.database.description.unrecoverable': '資料庫無法從健康快照恢復。音樂檔案不會被刪除；請先匯出診斷並查看保護目錄，再確認歸檔壞庫並重建空庫。',
  'settings.danger.database.description.recoverable': '偵測到資料庫不可用時，會先嘗試恢復健康快照；恢復前會先歸檔目前資料庫，音樂檔案不會被刪除。',
  'settings.danger.database.health.ok': '健康',
  'settings.danger.database.health.corrupt': '疑似損壞',
  'settings.danger.database.health.unreadable': '無法讀取',
  'settings.danger.database.health.idle': '待檢查',
  'settings.danger.database.steps.quarantined.1': '目前曲庫已被移出活動位置，ECHO 不會再讀取那批危險標籤。',
  'settings.danger.database.steps.quarantined.2': '優先使用「修復隔離庫副本」，它只處理歸檔副本，驗證通過後才恢復。',
  'settings.danger.database.steps.quarantined.3': '若修復失敗，再選擇恢復健康快照或歸檔並重建空曲庫；音樂檔案不會被刪除。',
  'settings.danger.database.steps.unrecoverable.1': '先確認掃描沒有執行；掃描中會拒絕恢復、重建與刪除。',
  'settings.danger.database.steps.unrecoverable.2': '優先匯出診斷並打開保護目錄，保留壞庫歸檔線索。',
  'settings.danger.database.steps.unrecoverable.3': '輸入確認詞「重建空庫」後，歸檔壞庫並重建空庫，再重新加入曲庫資料夾並掃描。',
  'settings.danger.database.steps.recoverable.1': '先確認掃描沒有執行；掃描中會拒絕恢復、重建與刪除。',
  'settings.danger.database.steps.recoverable.2': '優先點「恢復最近健康快照」，它只接受主程序列舉出的快照。',
  'settings.danger.database.steps.recoverable.3': '沒有健康快照或恢復後仍損壞時，使用「歸檔壞庫並重建空庫」。',
  'settings.danger.database.action.check': '檢查健康',
  'settings.danger.database.action.checking': '檢查中...',
  'settings.danger.database.action.create': '建立健康快照',
  'settings.danger.database.action.creating': '建立中...',
  'settings.danger.database.action.restore': '恢復最近健康快照',
  'settings.danger.database.action.restoring': '恢復中...',
  'settings.danger.database.action.scrub': '修復隔離庫副本',
  'settings.danger.database.action.scrubbing': '修復中...',
  'settings.danger.database.action.rebuild': '歸檔壞庫並重建空庫',
  'settings.danger.database.action.rebuilding': '重建中...',
  'settings.danger.database.action.discard': '歸檔問題曲目',
  'settings.danger.database.action.discarding': '歸檔中...',
  'settings.danger.database.action.relaunch': '重新啟動到恢復模式',
  'settings.danger.database.action.relaunching': '重新啟動中...',
  'settings.danger.database.action.open': '打開保護目錄',
  'settings.danger.database.action.export': '匯出診斷',
  'settings.danger.database.action.exporting': '匯出中...',
  'settings.danger.database.meta.current': '目前資料庫',
  'settings.danger.database.meta.snapshot': '最近健康快照',
  'settings.danger.database.meta.snapshotHint': '可手動建立',
  'settings.danger.database.meta.archive': '最近壞庫歸檔',
  'settings.danger.database.meta.archiveHint': '恢復/重建前會自動歸檔',
  'settings.danger.database.meta.pending': '待載入',
  'settings.danger.database.meta.noSnapshot': '暫無健康快照',
  'settings.danger.database.meta.noArchive': '暫無壞庫歸檔',
  'settings.danger.database.unavailable.scrub': '找不到可修復的隔離庫副本；請打開保護目錄確認歸檔是否存在，或直接匯出診斷。',
  'settings.danger.database.unavailable.restore': '暫無健康快照可恢復。可以先建立健康快照；若目前曲庫不可用，請匯出診斷。',
  'settings.danger.database.confirmWord': '危險操作確認詞',
  'settings.danger.database.confirmPlaceholder': '先輸入按鈕提示的確認詞，再執行危險操作',
  'settings.danger.database.scanRunning': '曲庫掃描正在執行，恢復、重建與刪除會被拒絕。請等掃描結束後再操作。',
  'settings.danger.duplicates.title': '掃描重複歌曲並清理',
  'settings.danger.duplicates.description': '先掃描並列出重複組；清理時優先把低音質、低評分副本移入系統資源回收筒，每組保留評分最高的一首。',
  'settings.danger.duplicates.meta.result': '掃描結果',
  'settings.danger.duplicates.meta.resultValue': '{groups} 組 / {tracks} 首待清理',
  'settings.danger.duplicates.meta.release': '預計釋放',
  'settings.danger.duplicates.meta.scanTime': '掃描時間',
  'settings.danger.duplicates.meta.notScanned': '尚未掃描',
  'settings.danger.duplicates.action.scan': '掃描重複歌曲',
  'settings.danger.duplicates.action.scanning': '掃描中...',
  'settings.danger.duplicates.action.clean': '清理掃描結果',
  'settings.danger.duplicates.action.cleaning': '清理中...',
  'settings.danger.duplicates.progress.scan.title': '正在掃描重複歌曲',
  'settings.danger.duplicates.progress.scan.description': '分批處理，避免擠占播放',
  'settings.danger.duplicates.progress.scan.aria': '重複歌曲掃描中',
  'settings.danger.duplicates.progress.clean.title': '正在清理掃描結果',
  'settings.danger.duplicates.progress.clean.description': '移入資源回收筒並更新曲庫索引',
  'settings.danger.duplicates.progress.clean.aria': '重複歌曲清理中',
  'settings.danger.clearCache.title': '清空媒體庫快取',
  'common.unavailable': '暫不可用',
  'common.ready': '就緒',
  'common.checking': '檢查中',
  'common.yes': '是',
  'common.no': '否',
};

const jaJP: TranslationMap = {
  ...zhCN,
  'albumTagEditor.action.applyToForm': 'フォームに適用',
  'albumTagEditor.action.cancel': 'キャンセル',
  'albumTagEditor.action.chooseCover': 'カバーを選択',
  'albumTagEditor.action.close': 'タグ編集を閉じる',
  'albumTagEditor.action.deleteAlbum': 'アルバムを削除',
  'albumTagEditor.action.loadEmbedded': '埋め込みタグを再読み込み',
  'albumTagEditor.action.loading': '読み込み中',
  'albumTagEditor.action.loadNetwork': 'ネットワークから読み込み',
  'albumTagEditor.action.openInExplorer': 'フォルダで開く',
  'albumTagEditor.action.saveTags': 'タグを保存',
  'albumTagEditor.action.saving': '保存中',
  'albumTagEditor.action.searchCandidates': '候補を検索',
  'albumTagEditor.action.searching': '検索中',
  'albumTagEditor.albumSummary': '{count} 曲 / {duration}',
  'albumTagEditor.cover.embeddedSuffix': ' / 埋め込みタグからカバーを再読み込み済み',
  'albumTagEditor.cover.localSuffix': ' / ローカルカバー: {path}',
  'albumTagEditor.cover.networkSuffix': ' / ネットワークカバーは保存時にダウンロードして書き込みます',
  'albumTagEditor.currentAlbum': '現在のアルバム',
  'albumTagEditor.currentAlbumAria': '現在のアルバム',
  'albumTagEditor.discard.continue': '編集を続ける',
  'albumTagEditor.discard.discard': '変更を破棄',
  'albumTagEditor.discard.prompt': '未保存の変更があります。閉じて破棄しますか？',
  'albumTagEditor.duration.hoursMinutes': '{hours} 時間 {minutes} 分',
  'albumTagEditor.duration.minutes': '{minutes} 分',
  'albumTagEditor.duration.unknown': '長さ不明',
  'albumTagEditor.error.chooseCoverUnsupported': '現在の実行環境ではカバーを選択できません。',
  'albumTagEditor.error.embeddedUnsupported': '現在の実行環境では埋め込みタグを読み取れません。',
  'albumTagEditor.error.fixYearBeforeSave': '保存する前に年を修正してください。',
  'albumTagEditor.error.networkTemporary': 'ネットワークソースは一時的に利用できません。後でもう一度試してください。',
  'albumTagEditor.error.networkUnsupported': '現在の実行環境ではネットワークタグ検索を利用できません。',
  'albumTagEditor.error.noReadableTrack': 'このアルバムにはタグを読み取れる曲がありません。',
  'albumTagEditor.error.openFolderUnsupported': '現在の実行環境ではフォルダを開けません。',
  'albumTagEditor.error.positiveInteger': '{label} は正の整数または空欄にしてください',
  'albumTagEditor.error.readTracksUnsupported': '現在の実行環境ではアルバム曲目を読み取れません。',
  'albumTagEditor.field.album': 'アルバム',
  'albumTagEditor.field.albumArtist': 'アルバムアーティスト',
  'albumTagEditor.field.cover': 'カバー',
  'albumTagEditor.field.genre': 'ジャンル',
  'albumTagEditor.field.year': '年',
  'albumTagEditor.message.appliedNetwork': 'フォームに適用しました。保存するとアルバム内の曲へ書き込まれます。',
  'albumTagEditor.message.noNetworkTags': '適切なネットワークタグが見つかりませんでした。',
  'albumTagEditor.message.searchingNetwork': 'ネットワークタグを検索中...',
  'albumTagEditor.network.aria': 'ネットワーク候補の比較',
  'albumTagEditor.network.column.candidate': '候補',
  'albumTagEditor.network.column.current': '現在',
  'albumTagEditor.network.column.field': '項目',
  'albumTagEditor.network.selectAll': 'すべて選択',
  'albumTagEditor.network.selectFields': 'アルバムに適用する項目を選択',
  'albumTagEditor.network.title': 'ネットワーク候補',
  'albumTagEditor.saveDescription': '保存すると、このアルバム内のすべての曲の埋め込みタグを書き込み、ライブラリをすぐ同期します。',
  'albumTagEditor.section.albumInfo': 'アルバム情報',
  'albumTagEditor.section.albumInfoDescription': 'このアルバム内の曲へ一括書き込みします',
  'albumTagEditor.subtitle.albumBatch': 'アルバム単位の一括タグ',
  'albumTagEditor.subtitle.unsaved': '未保存の変更',
  'albumTagEditor.title': 'タグを編集',
  'albumTagEditor.value.albumCandidate': 'アルバム候補',
  'albumTagEditor.value.empty': '空',
  'albumTagEditor.value.existingCover': '既存カバー',
  'albumTagEditor.value.networkCover': 'ネットワークカバー',
  'albumTagEditor.value.unknownAlbum': '不明なアルバム',
  'albumTagEditor.value.unknownArtist': '不明なアーティスト',
  'firstRun.action.finish': '設定を完了',
  'firstRun.action.next': '次へ',
  'firstRun.action.previous': '戻る',
  'firstRun.action.skip': 'スキップ',
  'firstRun.action.skipWizard': 'ウィザードをスキップ',
  'firstRun.aria.steps': '初回起動の手順',
  'firstRun.aria.summary': '現在のウィザード選択の概要',
  'firstRun.audio.asio.description': 'ASIO デバイスと安定したドライバーが必要です。',
  'firstRun.audio.asio.hint': 'プロ向け',
  'firstRun.audio.asio.label': 'ASIO',
  'firstRun.audio.exclusive.description': '安定確認済みの外部オーディオ機器や HiFi 調整向けの排他出力です。',
  'firstRun.audio.exclusive.hint': '詳細',
  'firstRun.audio.exclusive.label': 'WASAPI Exclusive',
  'firstRun.audio.linuxShared.description': 'Linux オーディオスタック経由で ECHO ネイティブ出力を使います。',
  'firstRun.audio.linuxShared.hint': '詳細',
  'firstRun.audio.linuxShared.label': 'Linux Shared',
  'firstRun.audio.shared.description': '詳細オーディオエンジンの日常用共有出力です。',
  'firstRun.audio.shared.hint': '詳細',
  'firstRun.audio.shared.label': 'WASAPI Shared',
  'firstRun.audio.system.description': '最も安定しています。一般的なヘッドホン、Bluetooth、PC スピーカー向けです。',
  'firstRun.audio.system.hint': '推奨',
  'firstRun.audio.system.label': '標準出力（推奨）',
  'firstRun.accounts.cookie.description': 'プラットフォームのログイン画面が使えない場合は Cookie を手動で貼り付けて保存し、その後「確認」で状態を見てください。',
  'firstRun.accounts.cookie.title': '予備の方法',
  'firstRun.accounts.login.description': 'NetEase、QQ Music、Bilibili、SoundCloud などは、まず「ログインして同期」を使います。完了後、ECHO が必要な認証情報を保存します。',
  'firstRun.accounts.login.title': 'まず Web ログイン',
  'firstRun.accounts.note': 'ストリーミングアカウントは任意です。ローカル再生には影響しません。ECHO は各サービスが実際に返す再生可能な内容だけを使います。',
  'firstRun.accounts.open.description': 'ウィザード後に「設定 > 連携 > アカウントログイン」を開くと、ストリーミング、MV、ダウンロード、歌詞用アカウントをまとめて管理できます。',
  'firstRun.accounts.open.title': '開く場所',
  'firstRun.accounts.spotify.description': 'Spotify は公式プレイヤー/Connect を使い、Premium が必要です。ダウンロード可能な音声 URL は提供されません。',
  'firstRun.accounts.spotify.title': 'Spotify の注意',
  'firstRun.cache.chooseLocation': 'キャッシュ場所を選択',
  'firstRun.cache.useDefault': '既定を使用',
  'firstRun.currentSelection': '現在の選択',
  'firstRun.defaultLocation': '既定の場所',
  'firstRun.description': 'ライブラリ、キャッシュ、スキャン、出力、外観、アカウント入口を順に確認します。迷ったら推奨値のままで大丈夫です。',
  'firstRun.error.desktopBridgeCache': 'デスクトップブリッジを利用できないため、キャッシュ場所を選択できません。',
  'firstRun.error.desktopBridgeMusicFolder': 'デスクトップブリッジを利用できないため、音楽フォルダーを選択できません。',
  'firstRun.error.desktopBridgeSave': 'デスクトップブリッジを利用できないため、初回起動設定を保存できません。',
  'firstRun.library.chooseFolder': 'フォルダーを選択',
  'firstRun.library.noneSelected': '未選択です。後から追加してもかまいません。',
  'firstRun.library.scanAfterFinish': '完了後にスキャン',
  'firstRun.message.saved': '初回起動設定を保存しました。',
  'firstRun.scan.balanced.description': '推奨。スキャン速度とバックグラウンド負荷のバランスが安定しています。',
  'firstRun.scan.balanced.hint': '既定',
  'firstRun.scan.balanced.label': 'バランス',
  'firstRun.scan.low.description': '再生への影響を抑えます。スキャンは少し遅くなります。',
  'firstRun.scan.low.hint': '聴きながら',
  'firstRun.scan.low.label': '低負荷',
  'firstRun.scan.performance.description': 'できるだけ早くライブラリを構築します。PC が空いている時に向いています。',
  'firstRun.scan.performance.hint': '空き時間',
  'firstRun.scan.performance.label': '高速',
  'firstRun.step.audio.description': '一般的なヘッドホン、Bluetooth、PC スピーカーには標準出力を推奨します。外部機器、排他出力、ASIO は安定確認後に使ってください。',
  'firstRun.step.audio.eyebrow': '4 / 7',
  'firstRun.step.audio.label': '出力',
  'firstRun.step.audio.title': 'オーディオ出力を選択',
  'firstRun.step.appearance.description': '全体の明暗モードとテーマ配色を先に選びます。ライトは昼間や作業向け、ダークは夜間向けです。迷ったらシステム連動にしてください。',
  'firstRun.step.appearance.eyebrow': '5 / 7',
  'firstRun.step.appearance.label': '外観',
  'firstRun.step.appearance.title': 'テーマと明暗モードを選択',
  'firstRun.step.accounts.description': 'ストリーミングアカウントは後からログインできます。オンライン検索、プレイリスト同期、MV/歌詞照合、一部のダウンロードに使われます。',
  'firstRun.step.accounts.eyebrow': '6 / 7',
  'firstRun.step.accounts.label': 'アカウント',
  'firstRun.step.accounts.title': 'ストリーミングログイン',
  'firstRun.step.cache.description': 'カバー、歌詞、MV キャッシュはディスク容量を使います。C ドライブに余裕がない場合は別ドライブをおすすめします。',
  'firstRun.step.cache.eyebrow': '2 / 7',
  'firstRun.step.cache.label': 'キャッシュ',
  'firstRun.step.cache.title': 'キャッシュ場所を選択',
  'firstRun.step.library.description': '音楽ルートを選ぶと、ECHO がタグ、カバー、長さ、歌詞の手がかりを読み取ってライブラリを作ります。ファイルは移動・削除しません。',
  'firstRun.step.library.eyebrow': '1 / 7',
  'firstRun.step.library.label': '音楽',
  'firstRun.step.library.title': '音楽フォルダーを選択',
  'firstRun.step.scan.description': '初回スキャンは負荷が高めです。普段はバランス、聴きながらなら低負荷、PC が空いている時は高速がおすすめです。',
  'firstRun.step.scan.eyebrow': '3 / 7',
  'firstRun.step.scan.label': 'スキャン',
  'firstRun.step.scan.title': 'スキャン方法を選択',
  'firstRun.step.summary.description': '確認後は基本設定だけを保存します。初回起動ガイドは設定から再表示でき、アカウントも後からログインできます。',
  'firstRun.step.summary.eyebrow': '7 / 7',
  'firstRun.step.summary.label': '確認',
  'firstRun.step.summary.title': '設定を確認',
  'firstRun.summary.addLater': '後で追加',
  'firstRun.summary.accounts': 'アカウント',
  'firstRun.summary.accountsLater': '後で設定 > 連携からログイン',
  'firstRun.summary.cache': 'キャッシュ',
  'firstRun.summary.kicker': '概要',
  'firstRun.summary.music': '音楽',
  'firstRun.summary.noFileMove': '音楽ファイルを移動または削除することはありません。',
  'firstRun.summary.output': '出力',
  'firstRun.summary.readyDescription': '完了を押すと設定を保存します。フォルダーを選び、スキャンにチェックしている場合は ECHO がライブラリインデックスを作成します。',
  'firstRun.summary.readyTitle': '準備できました',
  'firstRun.summary.scan': 'スキャン',
  'firstRun.summary.scanWithFolder': '{mode}、完了後にスキャン',
  'firstRun.summary.theme': '外観',
  'firstRun.summary.themeValue': '{mode}、{preset}',
  'firstRun.theme.dark.description': '夜間の明るさを抑えます。暗い部屋や OLED に向いています。',
  'firstRun.theme.dark.hint': '夜間',
  'firstRun.theme.light.description': '文字が読みやすく、昼間、作業、スクリーンショット向けです。',
  'firstRun.theme.light.hint': '明るい',
  'firstRun.theme.modeTitle': '明暗モード',
  'firstRun.theme.presetTitle': 'テーマ配色',
  'firstRun.theme.system.description': 'Windows またはシステムの外観に合わせて自動で切り替えます。',
  'firstRun.theme.system.hint': '自動',
  'firstRun.title': 'ECHO Next へようこそ',
  'downloads.action.addToQueue': 'キューに追加',
  'downloads.action.cancelJob': 'タスクをキャンセル',
  'downloads.action.changeFolder': 'フォルダーを変更',
  'downloads.action.checkTools': '環境をチェック',
  'downloads.action.chooseFolder': 'フォルダーを選択',
  'downloads.action.clearCompleted': '完了済みをクリア',
  'downloads.action.creating': '作成中',
  'downloads.action.search': '検索',
  'downloads.action.searching': '検索中',
  'downloads.description': '内蔵 yt-dlp で YouTube / Bilibili を検索し、利用可能な最高音質だけをダウンロードします。',
  'downloads.empty.noResults.description': '別のキーワードで試してください。',
  'downloads.empty.noResults.title': '検索結果なし',
  'downloads.empty.queue.description': 'リンク貼り付けや検索結果からダウンロードすると、ここに実際の進捗が表示されます。',
  'downloads.empty.queue.title': 'キューは空です',
  'downloads.empty.searching.description': '{scope} を検索中です。',
  'downloads.empty.searching.title': '検索中',
  'downloads.error.cookieFallback': 'ブラウザー Cookie を読み取れません。ログイン状態なしでの検索を自動的に試しました。',
  'downloads.error.ipcUnavailable': '現在の実行環境ではダウンロード IPC が公開されていません。',
  'downloads.error.operationFailed': 'ダウンロード操作に失敗しました',
  'downloads.folder.required': 'ダウンロードフォルダーを選択してください',
  'downloads.job.imported': 'ライブラリにインポート済み',
  'downloads.job.savedTo': '{path} に保存',
  'downloads.job.waitingProgress': '進捗待ち',
  'downloads.message.clearedTerminal': '完了、失敗、キャンセル済みのタスクをクリアしました。',
  'downloads.message.completed': 'ダウンロード完了: {title}',
  'downloads.message.queued': 'ダウンロードキューに追加しました。',
  'downloads.message.resultQueued': 'キューに追加しました: {title}',
  'downloads.queue.title': 'ダウンロードキュー',
  'downloads.search.aria': '検索ダウンロード',
  'downloads.search.downloadAudio': '音声をダウンロード',
  'downloads.search.joined': 'キューに追加済み',
  'downloads.search.placeholder': '曲、アーティスト、動画タイトルを検索',
  'downloads.search.providerErrorItem': '{provider}: {error}',
  'downloads.search.providerErrors': '一部プラットフォームの検索に失敗しました: {errors}',
  'downloads.search.scopeAria': '検索プラットフォーム',
  'downloads.search.title': '検索ダウンロード',
  'downloads.search.unknownUploader': '不明な投稿者',
  'downloads.search.views': '{count} 回再生',
  'downloads.search.viewsWan': '{count} 万回再生',
  'downloads.settings.audioStrategy': '音声方針',
  'downloads.settings.bestAvailable': '利用可能な最高音質',
  'downloads.settings.bindMvAfterImport': 'インポート後にソース URL を MV として紐付け',
  'downloads.settings.importToLibrary': '完了後にライブラリへインポート',
  'downloads.settings.outputDirectory': 'ダウンロードフォルダー',
  'downloads.settings.title': 'ダウンロード設定',
  'downloads.status.bindingMv': 'MV 紐付け中',
  'downloads.status.cancelled': 'キャンセル済み',
  'downloads.status.completed': '完了',
  'downloads.status.downloading': 'ダウンロード中',
  'downloads.status.extractingAudio': '音声抽出中',
  'downloads.status.failed': '失敗',
  'downloads.status.importing': 'ライブラリへインポート中',
  'downloads.status.probing': 'リンク解析中',
  'downloads.status.queued': 'キュー待ち',
  'downloads.title': 'ダウンロード',
  'downloads.tools.notBundled': 'アプリに同梱されていません',
  'downloads.tools.notDetected': '検出されていません',
  'downloads.tools.title': '環境チェック',
  'downloads.url.placeholder': 'YouTube / Bilibili / SoundCloud / osu! リンクを貼り付け',
  'downloads.url.title': 'リンクを貼り付けてダウンロード',
  'albumMenu.action.addToPlaylist': 'プレイリストに追加...',
  'albumMenu.action.addToQueue': 'キューに追加',
  'albumMenu.action.copyCover': 'アルバムカバーをコピー',
  'albumMenu.action.copyInfo': 'アルバム情報をコピー',
  'albumMenu.action.deleteAlbum': 'アルバムを削除',
  'albumMenu.action.editTags': 'タグを編集',
  'albumMenu.action.likeAlbum': 'アルバムをお気に入りに追加',
  'albumMenu.action.playAlbum': 'アルバムを再生',
  'albumMenu.action.saveCover': 'アルバムカバーを保存',
  'albumMenu.action.unlikeAlbum': 'アルバムのお気に入りを解除',
  'albumMenu.playlistSubmenu.aria': 'プレイリストを選択',
  'albumMenu.playlistSubmenu.empty': 'ローカルプレイリストなし',
  'albumMenu.playlistSubmenu.itemCount': '{count} 曲',
  'albumMenu.playlistSubmenu.loading': 'プレイリストを読み込み中...',
  'accountProvider.kugou': 'KuGou Music',
  'accountProvider.netease': 'NetEase Cloud Music',
  'accountProvider.qqmusic': 'QQ Music',
  'accountProvider.unknown': '不明なアカウント',
  'desktopLyrics.aria.stage': 'デスクトップ歌詞',
  'desktopLyrics.control.close': '閉じる',
  'desktopLyrics.control.colorSwatch': '色 {color}',
  'desktopLyrics.control.customColor': 'カスタムカラー',
  'desktopLyrics.control.decreaseFontSize': '文字サイズを小さく',
  'desktopLyrics.control.decreaseScale': '縮小',
  'desktopLyrics.control.increaseFontSize': '文字サイズを大きく',
  'desktopLyrics.control.increaseScale': '拡大',
  'desktopLyrics.control.lock': 'ロック',
  'desktopLyrics.control.resetPosition': '位置をリセット',
  'desktopLyrics.control.romanization': 'デスクトップ歌詞にローマ字を表示',
  'desktopLyrics.control.themeColor': 'テーマ色に合わせる',
  'desktopLyrics.control.translation': 'デスクトップ歌詞に翻訳を表示',
  'desktopLyrics.control.translationShort': '訳',
  'desktopLyrics.primary.empty': '歌詞がありません',
  'desktopLyrics.primary.instrumental': 'インストゥルメンタルです',
  'desktopLyrics.secondary.waiting': '再生待ち',
  'lyricsView.empty.instrumental': 'インストゥルメンタルです',
  'lyricsView.empty.noLyrics': '歌詞がありません',
  'mvPanel.action.close': '閉じる',
  'mvPanel.action.copied': 'コピーしました',
  'mvPanel.action.copy': 'コピー',
  'mvPanel.action.dismissUnavailable': 'MV 利用不可の通知を閉じる',
  'mvPanel.diagnostics.title': 'MV 診断レポート',
  'mvPanel.notice.unavailable': 'MV を利用できません',
  'mvPanel.status.bilibiliBlocked': 'Bilibili が一時的に解析を拒否しました。後で再試行するか外部で開いてください',
  'mvPanel.status.databaseUnread': 'MV データベースを読み取れません',
  'mvPanel.status.externalRequired': 'この MV は外部再生が必要です',
  'mvPanel.status.inAppUnavailable': 'この MV はアプリ内で再生できません',
  'mvPanel.status.loadFailed': 'MV の読み込みに失敗しました',
  'mvPanel.status.loading': 'MV を読み込み中',
  'mvPanel.status.localUnsupported': 'ローカル動画形式に対応していません',
  'mvPanel.status.missingUrl': '再生できる URL がありません',
  'mvPanel.status.networkFailed': 'ネットワーク MV リクエストに失敗しました',
  'mvPanel.status.notFound': '再生できる MV が見つかりません',
  'mvPanel.status.temporaryPlayback': '一時 MV を再生中。データベースの修復待ちです',
  'mvPanel.status.unavailable': 'MV を利用できません',
  'mvPanel.status.videoFailed': '動画の読み込みに失敗しました',
  'miniPlayer.action.close': 'ミニプレイヤーを閉じる',
  'miniPlayer.action.closeQueue': '再生キューを閉じる',
  'miniPlayer.action.closeShort': '閉じる',
  'miniPlayer.action.next': '次の曲',
  'miniPlayer.action.openQueue': '再生キューを開く',
  'miniPlayer.action.pause': '一時停止',
  'miniPlayer.action.play': '再生',
  'miniPlayer.action.previous': '前の曲',
  'miniPlayer.action.resetPosition': '位置をリセット',
  'miniPlayer.action.volume': '音量を調整',
  'miniPlayer.aria.progress': '再生位置',
  'miniPlayer.aria.queue': '再生キュー',
  'miniPlayer.aria.shell': 'ミニプレイヤー',
  'miniPlayer.aria.volume': '音量',
  'miniPlayer.artist.unknown': '不明なアーティスト',
  'miniPlayer.status.hqPlayerTakeover': 'HQPlayer が引き継ぎ中',
  'miniPlayer.status.queueEmpty': 'キューは空です',
  'miniPlayer.status.ready': '準備完了',
  'playerStatus.audioSpecifications': 'オーディオ仕様',
  'playerStatus.ready': '準備完了',
  'playerStatus.streaming': 'ストリーミング',
  'playerSpeed.label': '再生速度',
  'playerSpeed.reset': '再生速度をリセット',
  'playerVolume.fixed.disable': '固定音量をオフ',
  'playerVolume.fixed.enable': '固定音量をオン',
  'playerVolume.fixed.enabled': '固定音量がオン',
  'playerVolume.fixed.dsdAutoLocked': 'DSD 再生中は音量を自動固定しています',
  'playerVolume.fixed.title': '固定音量',
  'import.dragDrop.desktopBridgeUnavailable': 'デスクトップブリッジを利用できません。ECHO Next デスクトップ版でドロップしたファイルを取り込んでください。',
  'import.dragDrop.files.empty': '取り込める音声ファイルが見つかりません。',
  'import.dragDrop.files.failed': '{count} 個のファイルの取り込みに失敗しました',
  'import.dragDrop.files.ignored': '未対応ファイル {count} 個をスキップしました',
  'import.dragDrop.files.imported': '{count} 曲を取り込みました',
  'import.dragDrop.files.summaryWithOutput': '{summary}。ファイルの保存先: {outputDirectory}',
  'import.dragDrop.noDroppedFiles': 'ドロップされたファイルを読み取れませんでした。',
  'import.dragDrop.overlay.description': 'ファイルはダウンロードフォルダーに保存され、ライブラリに追加されます',
  'import.dragDrop.overlay.title': '音楽または osu! 譜面をドロップしてライブラリに取り込む',
  'import.dragDrop.paths.addedFolders': '{count} 個のフォルダーを追加しました',
  'import.dragDrop.paths.empty': '取り込める音楽ファイルまたはフォルダーが見つかりません',
  'import.dragDrop.paths.failed': '{count} 個のパスの取り込みに失敗しました',
  'import.dragDrop.paths.ignored': '未対応ファイル {count} 個をスキップしました',
  'import.dragDrop.paths.importedFiles': '{count} 個のファイルを取り込みました',
  'import.dragDrop.paths.missing': 'アクセスできないパス {count} 個をスキップしました',
  'import.dragDrop.paths.scannedAudioFolders': '音楽ファイルを含むフォルダー {count} 個をスキャンしました',
  'notice.accountExpired': 'アカウントのログイン状態が失効している可能性があります: {names}。設定 > 連携 から再ログインしてください。',
  'notice.accountExpired.title': 'アカウントログイン失効',
  'notice.action.close': '閉じる',
  'notice.action.closeNotice': '通知を閉じる',
  'notice.action.ignore': '無視',
  'notice.action.openReport': 'レポートを開く',
  'notice.audioError.description': 'Markdown 診断レポートを作成しました。詳しい原因と調査の手がかりが含まれています。',
  'notice.audioError.title': '音声エラー',
  'notice.audioDefaultFormatWarning': '音声設定の通知: Windows の既定形式が高めです。現在は {rate} です。ECHO は通知のみを行い、システム設定は変更しません。48 kHz への変更をおすすめします。',
  'notice.diagnosticsCrash.description': '前回 ECHO Next は正常終了しませんでした。調査用の Markdown レポートを準備しました。',
  'notice.importFiles.empty': '取り込める音声ファイルがありません。',
  'notice.importFiles.failed': '{count} 個のファイルの取り込みに失敗しました',
  'notice.importFiles.imported': '{count} 個のファイルをライブラリに追加しました',
  'notice.importFiles.skipped': '未対応または利用不可のファイル {count} 個をスキップしました',
  'notice.openFiles.partial': '{opened} 個のファイルを開き、未対応または利用不可のファイル {rejected} 個をスキップしました。',
  'notice.reportOpened': 'Markdown レポートを開きました。',
  'notice.reportOpenedPath': 'Markdown レポートを開きました: {path}',
  'notice.updateAvailable': 'ECHO NEXT の新しいバージョンが見つかりました。',
  'notice.updateAvailableVersion': 'ECHO NEXT の新しいバージョン {version} が見つかりました。',
  'notice.updateDownloaded': 'ECHO NEXT の更新をダウンロードしました。インストール準備ができています。',
  'notice.updateDownloadedVersion': 'ECHO NEXT {version} をダウンロードしました。インストール準備ができています。',
  'punctuation.clauseSeparator': '、',
  'punctuation.listSeparator': '、',
  'library.action.refresh': '更新',
  'library.albums.card.tracks': '{count} 曲',
  'library.albums.confirm.deleteAlbumFiles': 'アルバムファイルを削除しますか？\n{title}\n\n{count} 曲をシステムのごみ箱へ移動し、メディアライブラリから削除します。',
  'library.albums.error.coverNotSaved': 'アルバムカバーを保存しませんでした。',
  'library.albums.error.desktopBridge': 'デスクトップブリッジを利用できません。ECHO Next デスクトップ版でアルバムを読み込んでください。',
  'library.albums.error.noCopyableCover': 'このアルバムにはコピーできるカバーがありません。',
  'library.albums.error.noPlayableTracks': 'このアルバムには再生可能な曲がありません。',
  'library.albums.error.remoteEditUnsupported': 'リモートアルバムはタグ編集やサーバーファイル削除にまだ対応していません。',
  'library.albums.listAria': 'アルバム一覧',
  'library.albums.loading': 'アルバムを読み込み中...',
  'library.albums.searchPlaceholder': 'アルバム / アーティストを検索',
  'library.albums.sort.aria': 'アルバムの並び替え',
  'library.albums.sort.artist': 'アーティスト',
  'library.albums.sort.titleAsc': 'タイトル A-Z',
  'library.albums.sort.titleDesc': 'タイトル Z-A',
  'library.albums.title': 'アルバム',
  'libraryDiagnostics.lab.description': 'これらの機能はリアルタイムメディアライブラリ動作の開発テスト用です。既定ではオフで、通常ユーザーには影響しません。テストブランチまたはテストライブラリでのみ使ってください。',
  'library.artists.error.desktopBridge': 'デスクトップブリッジを利用できません。ECHO Next デスクトップ版でアーティストを読み込んでください。',
  'library.artists.avatarPriority': '画像優先',
  'library.artists.listAria': 'アーティスト一覧',
  'library.artists.loading': 'アーティストを読み込み中...',
  'library.artists.meta.albums': '{count} アルバム',
  'library.artists.meta.noTracks': '曲なし',
  'library.artists.meta.tracks': '{count} 曲',
  'library.artists.searchPlaceholder': 'アーティストを検索',
  'library.artists.sort.aria': 'アーティストの並び替え',
  'library.artists.sort.frequent': '曲数が多い順',
  'library.artists.sort.nameAsc': '名前 A-Z',
  'library.artists.sort.nameDesc': '名前 Z-A',
  'library.artists.title': 'アーティスト',
  'artistDetail.action.addToQueue': 'キューに追加',
  'artistDetail.action.back': 'アーティスト',
  'artistDetail.action.playArtist': 'アーティストを再生',
  'artistDetail.action.readingArtist': '読み込み中',
  'artistDetail.action.refreshInfo': '情報を更新',
  'artistDetail.action.shuffle': 'シャッフル',
  'artistDetail.albums.aria': '{artist} のアルバム',
  'artistDetail.albums.count': '{count} アルバム',
  'artistDetail.albums.empty': 'このアーティストに紐づくアルバムはまだありません。',
  'artistDetail.albums.error.desktopBridge': 'デスクトップブリッジを利用できません。ECHO Next デスクトップ版でアーティストのアルバムを読み込んでください。',
  'artistDetail.albums.heading': '{artist} のアルバム',
  'artistDetail.albums.loadedCount': '{loaded}/{total} アルバムを読み込み済み',
  'artistDetail.aroundWeb.aria': 'アーティストの公式サイトとソーシャルメディア',
  'artistDetail.aroundWeb.heading': 'Around the web',
  'artistDetail.aria.details': '{artist} のアーティスト詳細',
  'artistDetail.aria.events': 'アーティストのイベント',
  'artistDetail.aria.facts': 'アーティスト情報',
  'artistDetail.aria.metadata': 'アーティストメタデータ',
  'artistDetail.aria.onlineSources': 'オンラインアーティスト情報源',
  'artistDetail.aria.overview': 'アーティスト概要',
  'artistDetail.aria.relationshipMap': 'アーティスト関連マップ',
  'artistDetail.aria.sections': '{artist} 詳細セクション',
  'artistDetail.duration.hours': '{hours} 時間 {minutes} 分を読み込み済み',
  'artistDetail.duration.minutes': '{minutes} 分を読み込み済み',
  'artistDetail.duration.reading': '長さを読み込み中',
  'artistDetail.empty.relationships': 'ローカルの直接的な関連はまだ見つかっていません。',
  'artistDetail.error.desktopBridgeRead': 'デスクトップブリッジを利用できません。ECHO Next デスクトップ版でこのアーティストを読み込んでください。',
  'artistDetail.events.configureProviders': '公演情報には Bandsintown、Ticketmaster、SeatGeek のキー設定が必要です。未設定の場合、実際の公演データは読み込みません。',
  'artistDetail.events.collapse': '折りたたむ',
  'artistDetail.events.collapsedHint': '{count} 件の公演が見つかりました。展開すると日付、会場、チケットリンクを確認できます。',
  'artistDetail.events.count': '{count} 件の公演',
  'artistDetail.events.expand': '展開',
  'artistDetail.events.noConcerts': '今後の公演は見つかりませんでした。',
  'artistDetail.events.noConcertsRegion': '{region} で今後の公演は見つかりませんでした。',
  'artistDetail.events.providerKeysRequired': '提供元キーが必要です',
  'artistDetail.events.venuePending': '会場は未定です',
  'artistDetail.fact.albums': 'アルバム',
  'artistDetail.fact.loaded': '読み込み済み',
  'artistDetail.fact.sources': '情報源',
  'artistDetail.fact.tracks': '曲',
  'artistDetail.label.artist': 'アーティスト',
  'artistDetail.label.overview': '概要',
  'artistDetail.meta.albums': '{count} アルバム',
  'artistDetail.meta.loadedTracks': '{loaded}/{total} 読み込み済み',
  'artistDetail.meta.tracks': '{count} 曲',
  'artistDetail.missing.description': 'アーティスト一覧に戻ってライブラリを更新すると最新のカタログを確認できます。',
  'artistDetail.missing.title': 'アーティストが存在しないか、ライブラリから削除されました。',
  'artistDetail.overview.about': '{artist} について',
  'artistDetail.overview.bioFallback': 'ローカルライブラリから収集しました。オンラインのアーティスト情報はバックグラウンドで軽く読み込まれます。',
  'artistDetail.relation.bpm': 'BPM',
  'artistDetail.relation.collaboration': 'コラボ',
  'artistDetail.relation.evidence': '{label} / {evidence}',
  'artistDetail.relation.genre': 'ジャンル',
  'artistDetail.relation.history': '再生履歴',
  'artistDetail.relation.link': 'リンク',
  'artistDetail.relation.local': 'ローカルライブラリ信号',
  'artistDetail.relation.member': 'メンバー',
  'artistDetail.relation.sameAlbum': '同じアルバム',
  'artistDetail.relation.similar': '類似',
  'artistDetail.section.concertInfo': '公演情報',
  'artistDetail.section.events': 'イベント',
  'artistDetail.section.localNetwork': 'ローカルネットワーク',
  'artistDetail.section.relationshipMap': '関連マップ',
  'artistDetail.status.collectedLocally': 'ローカル収集',
  'artistDetail.status.linkedArtists': '{count} 関連アーティスト',
  'artistDetail.status.loadingSignals': 'ローカル信号を読み込み中',
  'artistDetail.status.localLibrary': 'ローカルライブラリ',
  'artistDetail.status.readingRelationships': 'アーティスト関連を読み込み中...',
  'artistDetail.status.readySoon': 'まもなく準備完了',
  'artistDetail.tab.albums': 'アルバム',
  'artistDetail.tab.overview': '概要',
  'artistDetail.tab.songs': '曲',
  'artistDetail.tracks.action.addToQueueAria': '{title} をキューに追加',
  'artistDetail.tracks.action.more': 'その他',
  'artistDetail.tracks.action.moreAria': '{title} のその他の操作',
  'artistDetail.tracks.action.playNext': '次に再生',
  'artistDetail.tracks.action.playNextAria': '{title} を次に再生',
  'artistDetail.tracks.aria': '{artist} の曲',
  'artistDetail.tracks.column.actions': '操作',
  'artistDetail.tracks.column.album': 'アルバム',
  'artistDetail.tracks.column.signal': '信号',
  'artistDetail.tracks.column.time': '時間',
  'artistDetail.tracks.column.title': 'タイトル',
  'artistDetail.tracks.confirm.delete': 'この音楽ファイルを削除しますか？\n{title}',
  'artistDetail.tracks.empty': 'このアーティストに紐づく曲はまだありません。',
  'artistDetail.tracks.error.actionUnavailable': 'この曲の操作はまだ利用できません。',
  'artistDetail.tracks.error.desktopBridgeActions': 'デスクトップブリッジを利用できません。ECHO Next デスクトップ版でファイル操作を使ってください。',
  'artistDetail.tracks.error.desktopBridgeEdit': 'デスクトップブリッジを利用できません。ECHO Next デスクトップ版で埋め込みタグを編集してください。',
  'artistDetail.tracks.error.desktopBridgeRead': 'デスクトップブリッジを利用できません。ECHO Next デスクトップ版でアーティストの曲を読み込んでください。',
  'artistDetail.tracks.expandAll': 'すべて展開',
  'artistDetail.tracks.error.noCoverSaved': 'この曲のカバーアートは保存されませんでした。',
  'artistDetail.tracks.error.noCoverToCopy': 'この曲にはコピーできるカバーアートがありません。',
  'artistDetail.tracks.error.remoteFileAction': 'リモート曲はまだローカルファイル操作に対応していません。',
  'artistDetail.tracks.formatAria': '曲の形式',
  'artistDetail.tracks.heading': '{artist} の曲',
  'artistDetail.tracks.loadedCount': '{loaded}/{total} 曲を読み込み済み',
  'artistDetail.tracks.loading': '曲を読み込み中...',
  'artistDetail.tracks.loadingTrack': '曲を読み込み中',
  'artistDetail.tracks.status.addedToPlaylist': 'プレイリストに追加しました: {playlist}',
  'artistDetail.tracks.status.albumNotFound': 'このアーティスト表示でアルバムが見つかりません: {album}',
  'artistDetail.tracks.status.notInQueue': 'この曲はキューにありません: {title}',
  'artistDetail.tracks.status.reloadedTags': '埋め込みタグを再読み込みしました: {title}',
  'artistDetail.tracks.status.removedFromQueue': 'キューから削除しました: {title}',
  'artistDetail.tracks.unknownAlbum': '不明なアルバム',
  'library.count.total': '全 {count} 件',
  'library.sort.createdAsc': '作成が古い順',
  'library.sort.createdDesc': '作成が新しい順',
  'library.sort.default': 'デフォルト',
  'library.sort.durationAsc': '短い順',
  'library.sort.durationDesc': '長い順',
  'library.sort.fileModifiedAsc': 'ファイル更新が古い順',
  'library.sort.fileModifiedDesc': 'ファイル更新が新しい順',
  'library.sort.random': 'ランダム',
  'library.sort.recent': '最近',
  'library.source.aria': 'ライブラリソース',
  'library.source.local': 'ローカル',
  'library.source.allRemote': 'すべてのクラウドソース',
  'library.source.remote': 'クラウド',
  'library.trackRow.action.addToPlaylist': 'プレイリストに追加',
  'library.trackRow.action.addToPlaylistLabel': '{title} をプレイリストに追加',
  'library.trackRow.action.addToQueue': 'キューに追加',
  'library.trackRow.action.addToQueueLabel': '{title} をキューに追加',
  'library.trackRow.action.download': 'ダウンロード',
  'library.trackRow.action.downloadLabel': '{title} をダウンロード',
  'library.trackRow.action.downloading': 'ダウンロード中 {percent}%',
  'library.trackRow.action.downloadingLabel': '{title} をダウンロード中 {percent}%',
  'library.trackRow.action.more': 'その他',
  'library.trackRow.action.moreLabel': '{title} のその他の操作',
  'library.trackRow.actions': '{title} の操作',
  'library.trackRow.audioSpecifications': 'オーディオ仕様',
  'library.trackRow.duplicateVersions.count': '{count} バージョン',
  'library.trackRow.duplicateVersions.title': '重複曲のバージョンを表示',
  'library.trackRow.openAlbum': 'アルバムを開く: {album}',
  'library.trackRow.openArtist': 'アーティストを開く: {artist}',
  'library.trackRow.status.playing': '再生中',
  'library.trackRow.status.unavailable': '利用不可',
  'app.navigation.main': 'メインナビゲーション',
  'app.navigation.utility': 'ユーティリティナビゲーション',
  'app.toolbar.quickActions': 'クイック操作',
  'app.toolbar.windowControls': 'ウィンドウ操作',
  'app.window.minimize': '最小化',
  'app.window.maximize': '最大化',
  'app.window.restore': '元に戻す',
  'app.window.fullscreen': '全画面',
  'app.window.exitFullscreen': '全画面を解除',
  'app.window.close': '閉じる',
  'albumDetail.action.addToQueue': 'キューに追加',
  'albumDetail.action.back': 'アルバム',
  'albumDetail.action.likeAlbum': 'アルバムをお気に入りに追加',
  'albumDetail.action.more': 'その他のアルバム操作',
  'albumDetail.action.openSource': 'ソースを開く',
  'albumDetail.action.playNow': '今すぐ再生',
  'albumDetail.action.readingAlbum': 'アルバムを読み込み中',
  'albumDetail.action.refresh': '更新',
  'albumDetail.action.showInFolder': 'フォルダで表示',
  'albumDetail.action.unlikeAlbum': 'アルバムのお気に入りを解除',
  'albumDetail.aria.details': '{album} のアルバム詳細',
  'albumDetail.aria.info': 'アルバム情報',
  'albumDetail.aria.metadata': 'アルバムメタデータ',
  'albumDetail.aria.openArtist': 'アーティスト {artist} を開く',
  'albumDetail.aria.sections': 'アルバムセクション',
  'albumDetail.aria.trackConsole': '{album} のトラックコンソール',
  'albumDetail.artist.notFound': 'アーティストが見つかりません: {artist}',
  'albumDetail.count.albums': '{count} 枚のアルバム',
  'albumDetail.count.loadedAlbums': '{loaded}/{total} 枚のアルバム',
  'albumDetail.count.loadedTracks': '{loaded}/{total} 曲',
  'albumDetail.count.tracks': '{count} 曲',
  'albumDetail.credit.role.arrangement': '編曲',
  'albumDetail.credit.role.composer': '作曲',
  'albumDetail.credit.role.engineering': '録音とエンジニアリング',
  'albumDetail.credit.role.label': 'リリースとレーベル',
  'albumDetail.credit.role.lyrics': '作詞',
  'albumDetail.credit.role.other': 'その他のクレジット',
  'albumDetail.credit.role.performer': '演奏',
  'albumDetail.credit.role.production': '制作',
  'albumDetail.credit.role.vocal': 'ボーカルと声',
  'albumDetail.credit.source.album': 'アルバムクレジット',
  'albumDetail.credit.source.label': 'レーベル',
  'albumDetail.credit.source.recording': 'トラッククレジット',
  'albumDetail.credit.source.work': '作品クレジット',
  'albumDetail.credit.summary.arrangement': '編曲、オーケストレーション、アダプテーションのクレジット。',
  'albumDetail.credit.summary.composer': 'リリース、録音、作品関係から取得した作曲クレジット。',
  'albumDetail.credit.summary.engineering': '録音、ミックス、マスタリング、音響エンジニアリングの情報。',
  'albumDetail.credit.summary.label': 'リリースに紐づくレーベルとカタログ情報。',
  'albumDetail.credit.summary.lyrics': '歌詞、言葉、台本などのライティングクレジット。',
  'albumDetail.credit.summary.other': 'オンラインメタデータで見つかった追加クレジット。',
  'albumDetail.credit.summary.performer': 'リリースや各録音に紐づく演奏クレジット。',
  'albumDetail.credit.summary.production': 'プロデューサーなど制作側のクレジット。',
  'albumDetail.credit.summary.vocal': 'メインボーカル、客演ボイス、ボーカル関連クレジット。',
  'albumDetail.credits.count': '{count} 件の人物 / 組織',
  'albumDetail.credits.entries': '{count} 件',
  'albumDetail.credits.heading': 'アルバムクレジット',
  'albumDetail.credits.overviewAria': 'クレジット概要',
  'albumDetail.credits.trackPrefix': 'トラック: {title}',
  'albumDetail.duration.hours': '{hours} 時間 {minutes} 分',
  'albumDetail.duration.minutes': '{minutes} 分',
  'albumDetail.fact.format': 'フォーマット',
  'albumDetail.fact.genre': 'ジャンル',
  'albumDetail.fact.library': 'ライブラリ',
  'albumDetail.fact.released': 'リリース',
  'albumDetail.information.albumProfile': 'アルバムプロフィール',
  'albumDetail.information.artistProfile': 'アーティストプロフィール',
  'albumDetail.information.atGlance': '概要',
  'albumDetail.information.externalLinks': '外部リンク',
  'albumDetail.information.overviewAria': 'アルバムとアーティストの概要',
  'albumDetail.label.album': 'アルバム',
  'albumDetail.online.emptyDescription': 'MusicBrainz と Wikipedia から十分に信頼できるアルバム一致情報が返りませんでした。',
  'albumDetail.online.emptyTitle': '信頼できるオンライン情報がありません',
  'albumDetail.online.match': 'MusicBrainz 一致',
  'albumDetail.online.noSource': '一致したソースはありません',
  'albumDetail.online.possibleMatch': 'MusicBrainz の候補一致',
  'albumDetail.online.reading': 'オンラインのアルバム情報を読み込み中...',
  'albumDetail.online.sources': 'オンラインソース',
  'albumDetail.online.unavailable': 'オンライン情報を利用できません',
  'albumDetail.ratings.count': '{count} 件の評価',
  'albumDetail.ratings.overviewAria': '外部アルバム評価',
  'albumDetail.releases.count': '{count} 件のリリース',
  'albumDetail.releases.current': '現在の一致',
  'albumDetail.releases.currentHint': 'ローカルアルバムが一致した MusicBrainz リリースを示します',
  'albumDetail.releases.heading': 'バージョン / リリース',
  'albumDetail.releases.overviewAria': 'アルバムリリース概要',
  'albumDetail.related.aria': '{artist} のライブラリアルバム',
  'albumDetail.related.heading': 'マイライブラリ',
  'albumDetail.related.loading': 'アルバムを読み込み中',
  'albumDetail.related.thisAlbum': 'このアルバム',
  'albumDetail.sources.barcode': 'バーコード',
  'albumDetail.sources.catalogNumber': 'カタログ番号',
  'albumDetail.sources.copyright': '著作権情報',
  'albumDetail.sources.kind.database': 'データベース',
  'albumDetail.sources.kind.official': '公式',
  'albumDetail.sources.kind.other': 'Web',
  'albumDetail.sources.kind.reference': '資料',
  'albumDetail.sources.kind.streaming': 'ストリーミング',
  'albumDetail.sources.labels': 'レーベル / カタログ',
  'albumDetail.sources.linksAria': 'アルバム外部ソースリンク',
  'albumDetail.sources.releaseAria': '現在一致したリリース情報',
  'albumDetail.sources.releaseDetails': '現在のリリース',
  'albumDetail.status.addedToQueue': '{count} 曲をキューに追加しました。',
  'albumDetail.status.copiedCover': 'カバー原画をコピーしました',
  'albumDetail.status.libraryReady': '{value} 準備完了',
  'albumDetail.status.readingSignal': '信号を読み込み中',
  'albumDetail.status.unknownGenre': '不明なジャンル',
  'albumDetail.status.unknownLength': '長さ不明',
  'albumDetail.status.unknownYear': '年不明',
  'albumDetail.tab.credits': 'クレジット',
  'albumDetail.tab.information': '情報',
  'albumDetail.tab.releases': 'バージョン',
  'albumDetail.tab.sources': 'ソース',
  'albumDetail.tab.tracks': 'トラック',
  'albumDetail.texture.discs': '{count} 枚組',
  'albumDetail.tracks.action.like': '{title} をお気に入りに追加',
  'albumDetail.tracks.action.likeTitle': 'お気に入りに追加',
  'albumDetail.tracks.action.unlike': '{title} のお気に入りを解除',
  'albumDetail.tracks.action.unlikeTitle': 'お気に入りを解除',
  'albumDetail.tracks.aria': 'アルバムトラック',
  'albumDetail.tracks.column.signal': '信号',
  'albumDetail.tracks.column.time': '時間',
  'albumDetail.tracks.column.title': 'タイトル',
  'albumDetail.tracks.confirm.delete': '音楽ファイルを削除しますか？\n{title}',
  'albumDetail.tracks.empty': 'このアルバムにトラックはありません。',
  'albumDetail.tracks.error.actionUnavailable': 'このトラック操作はまだ利用できません。',
  'albumDetail.tracks.error.desktopBridgeActions': 'デスクトップブリッジを利用できません。ファイル操作は ECHO Next デスクトップ版で実行してください。',
  'albumDetail.tracks.error.desktopBridgeEdit': 'デスクトップブリッジを利用できません。埋め込みタグの編集は ECHO Next デスクトップ版で実行してください。',
  'albumDetail.tracks.error.desktopBridgeRead': 'デスクトップブリッジを利用できません。アルバムトラックは ECHO Next デスクトップ版で読み込んでください。',
  'albumDetail.tracks.error.noCoverSaved': '保存できるカバーアートがありません。',
  'albumDetail.tracks.error.noCoverToCopy': 'このトラックにはコピーできるカバーアートがありません。',
  'albumDetail.tracks.error.remoteFileAction': 'リモートトラックはまだローカルファイル操作に対応していません。',
  'albumDetail.tracks.formatAria': 'トラック形式',
  'albumDetail.tracks.loadMore': 'さらに読み込む',
  'albumDetail.tracks.loading': '読み込み中...',
  'albumDetail.tracks.status.addedToPlaylist': 'プレイリストに追加しました: {playlist}',
  'albumDetail.tracks.status.albumNotFound': 'このアルバムを表示中です: {title}',
  'albumDetail.tracks.status.notInQueue': 'このトラックはキューにありません: {title}',
  'albumDetail.tracks.status.reloadedTags': '埋め込みタグから再読み込みしました: {title}',
  'albumDetail.tracks.status.removedFromQueue': 'キューから削除しました: {title}',
  'albumDetail.tracks.summaryAria': 'トラック概要',
  'audioDrawer.action.close': '音声設定を閉じる',
  'audioDrawer.action.copiedDiagnostics': '再生診断情報をコピーしました',
  'audioDrawer.action.copyDiagnostics': '再生診断情報をコピー',
  'audioDrawer.action.hideDevice': 'デバイスを非表示',
  'audioDrawer.action.openAsioPanel': 'ASIO パネルを開く',
  'audioDrawer.action.resetEngine': '音声エンジンをリセット',
  'audioDrawer.action.resetEngineBusy': '音声エンジンをリセット中',
  'audioDrawer.action.resetEngineDone': '音声エンジンをリセットしました',
  'audioDrawer.action.restore': '戻す',
  'audioDrawer.asioLatency.description': '現在開いているバッファーから、出力側で再生までに待つ時間を見積もります。低いほど反応が速く、高いほど安定して音切れしにくくなります。',
  'audioDrawer.asioLatency.recommended': '推奨レイテンシ',
  'audioDrawer.asioLatency.status': '要求 {requested} frames / オープン {opened} frames',
  'audioDrawer.asioLatency.value': '{value} ms',
  'audioDrawer.asioRoutes.title': 'ASIO 出力チャンネル',
  'audioDrawer.badge.bitPerfectReady': 'Bit-perfect 対応',
  'audioDrawer.badge.dspActive': 'DSP 有効',
  'audioDrawer.badge.juceFallback': 'JUCE フォールバック',
  'audioDrawer.badge.juceOutput': 'JUCE 出力',
  'audioDrawer.badge.resampling': 'リサンプル',
  'audioDrawer.badge.soxrResampler': 'SOXR',
  'audioDrawer.badge.speedUp': '速度アップ',
  'audioDrawer.buffer.asio': 'ASIO バッファー',
  'audioDrawer.buffer.auto': '自動',
  'audioDrawer.buffer.collapsedDescription': '既定では折りたたみます。開くとレイテンシプロファイルと ASIO バッファーを調整できます。',
  'audioDrawer.buffer.default': '既定',
  'audioDrawer.buffer.latencyProfile': 'レイテンシプロファイル',
  'audioDrawer.buffer.low': '低',
  'audioDrawer.buffer.profileDefault': 'プロファイル既定',
  'audioDrawer.buffer.safer': '安全寄り',
  'audioDrawer.buffer.stable': '安定',
  'audioDrawer.buffer.title': 'バッファー設定',
  'audioDrawer.buffer.ultraLow': '超低遅延',
  'audioDrawer.device.asioDriver': 'ASIO ドライバー',
  'audioDrawer.device.lowLatency': '低遅延',
  'audioDrawer.device.selected': '選択中',
  'audioDrawer.device.systemAudio': 'Windows ダイレクト出力',
  'audioDrawer.device.systemAudioDescription': '既定の Windows オーディオ経路。一般的なヘッドホン、Bluetooth、PC スピーカー向け',
  'audioDrawer.device.systemDefault': 'システム既定',
  'audioDrawer.device.systemDefaultOutput': 'システム既定出力',
  'audioDrawer.device.systemOutput': 'システム出力',
  'audioDrawer.device.systemSelectedRoute': 'システム選択ルート',
  'audioDrawer.empty.asioDevices': 'ASIO 出力デバイスが見つかりません。',
  'audioDrawer.empty.hiddenDevices': '非表示デバイスはありません。',
  'audioDrawer.empty.systemDevices': 'システム出力デバイスが見つかりません。',
  'audioDrawer.error.desktopBridgeUnavailable': 'デスクトップブリッジを利用できません',
  'audioDrawer.meter.direct': 'ダイレクト',
  'audioDrawer.meter.chain': 'チェーン',
  'audioDrawer.meter.mode': 'モード',
  'audioDrawer.meter.output': '出力',
  'audioDrawer.meter.rate': 'レート',
  'audioDrawer.meter.resample': 'リサンプル',
  'audioDrawer.meter.source': 'ソース',
  'audioDrawer.meter.latency': 'レイテンシ',
  'audioDrawer.guard.asioUnavailable.description': '既定ではオフです。No device found の後、同じ ASIO デバイスを短時間スキップし、安全な共有出力を使います。',
  'audioDrawer.guard.asioUnavailable.title': 'ASIO 不可時ガード',
  'audioDrawer.guard.exclusiveInstability.description': '既定ではオフです。WASAPI 排他で underrun が続く、またはデバイスが不安定になった場合、オンなら現在位置から安全な共有出力へ切り替えます。',
  'audioDrawer.guard.exclusiveInstability.title': '排他不安定時に共有へ切替',
  'audioDrawer.guard.soxrFallback.description': '既定ではオンです。共有 SOXR リサンプルが PCM 開始前に使えない場合、FFmpeg 既定のリサンプルに戻します。',
  'audioDrawer.guard.soxrFallback.title': 'SOXR フォールバックガード',
  'audioDrawer.latency.balanced': 'バランス',
  'audioDrawer.latency.balancedDetail': '2048 frames',
  'audioDrawer.latency.lowLatency': '低遅延',
  'audioDrawer.latency.lowLatencyDetail': '1024 frames / 不安定時は安定化',
  'audioDrawer.latency.stable': '安定',
  'audioDrawer.latency.stableDetail': '8192 frames',
  'audioDrawer.mode.exclusive': '排他',
  'audioDrawer.mode.exclusiveCandidate': '排他候補',
  'audioDrawer.mode.directSound': 'DirectSound 互換',
  'audioDrawer.mode.shared': '共有',
  'audioDrawer.note.asio': '低遅延のプロ向け音声インターフェイスです。ドライバー対応が必要です。',
  'audioDrawer.note.currentOutput': 'ここには実際に使っている出力経路が表示されます。共有は普段使い向け、ASIO と WASAPI 排他は金色で表示されます。',
  'audioDrawer.note.engine': '出力デバイス、モード、レート、EQ、リサンプル状態をすばやく確認できます。',
  'audioDrawer.note.juceOutput': '既定ではオフです。FFmpeg 互換経路を既定の出力にし、必要な場合だけ JUCE 出力を手動で有効化します。失敗時は自動で戻します。',
  'audioDrawer.note.juceDecode': '既定でオフです。オンにすると、リサンプル不要のローカル WAV/FLAC/MP3 は常駐ネイティブデコードを使います。MP3 は Windows Media 経由で、失敗時は FFmpeg に戻します。',
  'audioDrawer.note.dsdDop': '既定ではオフです。ローカル DSF を排他または ASIO で DoP 直出し、失敗時は FFmpeg PCM に戻します。最終確認は DAC 表示で行います。',
  'audioDrawer.note.asioNativeDsd': '既定ではオフです。ASIO + ローカル DSF + DoP 有効、かつ EQ/音量/速度/DSP なしの時だけ試し、失敗時は既存の DoP/PCM に戻します。',
  'audioDrawer.note.dsdAutoVolumeLock': '既定ではオフです。オンにすると DSD 再生中は ECHO 音量を一時的に 100% に固定し、PCM に戻ると元の音量へ復元します。',
  'audioDrawer.note.releaseExclusiveOnPause': '実験機能です。一時停止時に WASAPI 排他を解放し、他のアプリの音を通します。再生再開時に排他を取り直し、失敗時は一時的に共有へ戻します。',
  'audioDrawer.option.juceOutput': 'JUCE メイン出力',
  'audioDrawer.option.juceDecode': '常駐ネイティブデコード',
  'audioDrawer.option.dsdDop': 'DSD DoP 直出実験',
  'audioDrawer.option.asioNativeDsd': 'ASIO ネイティブ DSD 実験',
  'audioDrawer.option.dsdAutoVolumeLock': 'DSD 再生中に音量を自動固定',
  'audioDrawer.option.releaseExclusiveOnPause': '一時停止で排他を解放',
  'audioDrawer.option.active': 'オン',
  'audioDrawer.option.set': '設定',
  'audioDrawer.option.automix': 'Automix を有効化',
  'audioDrawer.option.automixActive': '現在の再生は Automix のプリミックス経路を使用しています。',
  'audioDrawer.option.automixDescription': '既定ではオフです。オンにすると、キュー再生中に現在の曲の終端と次の曲を自動で重ねてクロスフェードします。',
  'audioDrawer.option.rememberOutput': '出力設定を保存',
  'audioDrawer.option.rememberOutputDescription': '次回起動時に選択した出力デバイス、出力モード、バッファーなどの設定を復元します。',
  'audioDrawer.option.fixedVolume': '固定音量',
  'audioDrawer.option.fixedVolumeDescription': '有効にすると、ECHO の音量操作を 100% に固定します。ReplayGain は引き続き独立して有効です。',
  'audioDrawer.option.lowLoadPlaybackMode': '低負荷再生モード',
  'audioDrawer.option.lowLoadPlaybackModeDescription': '再生中のリアルタイムスペクトラム、頻繁な再生画面更新、ReplayGain/BPM 再解析、単語単位歌詞の高頻度更新、自動歌詞ディープ検索、カバー/アーティスト画像取得、MV プリロードを停止します。',
  'audioDrawer.option.lowLoadPlaybackEnhancements': '低負荷強化保護',
  'audioDrawer.option.lowLoadPlaybackEnhancementsDescription': '既定ではオフです。低負荷再生モードがオンの時だけ、ポーリング、デスクトップ歌詞、診断、バックグラウンドライブラリ処理、ストリーミングのプリウォーム、MV 自動検索をさらに抑えます。',
  'audioDrawer.option.showAsioPanelSettings': 'ASIO パネル設定を表示する',
  'audioDrawer.option.showAsioPanelSettingsDescription': '既定ではオフです。オンにすると ASIO デバイスの下に「ASIO パネルを開く」ボタンを表示します。',
  'audioDrawer.option.alsaShared': 'ALSA',
  'audioDrawer.option.alsaSharedDescription': 'Linux ALSA デバイス経由で出力します。',
  'audioDrawer.option.directSound': 'DirectSound 互換',
  'audioDrawer.option.directSoundDescription': '手動の互換モードです。遅延が大きいため、WASAPI 再生に問題がある場合だけ試してください。',
  'audioDrawer.option.linuxAutoShared': '自動',
  'audioDrawer.option.linuxAutoSharedDescription': 'ALSA を優先し、システムの PipeWire/ALSA 互換レイヤー設定に従います。',
  'audioDrawer.option.sharedBackend': '共有バックエンド',
  'audioDrawer.option.wasapiShared': 'WASAPI Shared',
  'audioDrawer.option.wasapiSharedDescription': '通常の Windows 共有出力経路です。',
  'audioDrawer.option.wasapiExclusive': 'WASAPI 排他モード',
  'audioDrawer.option.wasapiExclusiveDescription': '共有は通常の Windows 出力経路です。排他は同じデバイスを共有ミキサーなしで開きます。DAC/オーディオデバイスとドライバーが安定している場合だけ推奨します。Realtek などのオンボードドライバーは相性が弱く、無音・途切れ・切り替え失敗の原因になることがあります。',
  'audioDrawer.section.advancedOutput': '高度なオーディオエンジン',
  'audioDrawer.section.advancedOutputDescription': '外部オーディオ機器、WASAPI Exclusive、ASIO、HiFi 調整向け',
  'audioDrawer.section.automix': 'Automix',
  'audioDrawer.section.asioDevices': 'ASIO 出力デバイス',
  'audioDrawer.section.currentOutput': '現在の出力',
  'audioDrawer.section.hiddenDevices': '非表示デバイス',
  'audioDrawer.section.systemDevices': '推奨出力',
  'audioDrawer.signal.balanceDsp': 'バランス DSP',
  'audioDrawer.signal.bitPerfect': 'Bit-perfect',
  'audioDrawer.signal.dspOn': 'DSP オン',
  'audioDrawer.signal.eqOff': 'EQ オフ',
  'audioDrawer.signal.eqOn': 'EQ オン',
  'audioDrawer.signal.asioSdkOutput': 'ASIO SDK 出力',
  'audioDrawer.signal.ffmpegDecode': 'FFmpeg デコード',
  'audioDrawer.signal.dsdDop': 'DSF bitstream -> DoP',
  'audioDrawer.signal.dsdDopFallback': 'DSD DoP fallback',
  'audioDrawer.signal.dsdDopStandby': 'DoP not used',
  'audioDrawer.signal.juceDecode': 'JUCE デコード',
  'audioDrawer.signal.juceDecodeFallback': 'JUCE デコード fallback',
  'audioDrawer.signal.juceDecodeStandby': 'JUCE デコード未適用',
  'audioDrawer.signal.nativeRate': 'ネイティブレート',
  'audioDrawer.signal.noActiveSource': 'アクティブなソースなし',
  'audioDrawer.signal.pending': '保留中',
  'audioDrawer.signal.processed': '処理済み',
  'audioDrawer.signal.sharedMixer': '共有ミキサー',
  'audioDrawer.signal.standardPath': '標準経路',
  'audioDrawer.status.noTrack': '曲なし',
  'audioDrawer.status.ratePending': 'レート未確定',
  'audioDrawer.status.sampleRatePending': 'サンプルレート未確定',
  'audioDrawer.title': '音声設定',
  'audioDrawer.warning.highOutputSampleRate': '現在のオーディオデバイスのサンプルレートが高すぎるため、再生速度が異常になる可能性があります。48 kHz への変更をおすすめします。',
  'audioProfessional.action.hideDetails': '詳細を閉じる',
  'audioProfessional.action.refresh': '状態を更新',
  'audioProfessional.action.showDetails': '詳細を表示',
  'audioProfessional.badge.bitPerfect': 'Bit-perfect',
  'audioProfessional.badge.dsp': 'DSP active',
  'audioProfessional.badge.protect': 'Protect',
  'audioProfessional.badge.replayGain': 'ReplayGain',
  'audioProfessional.badge.resampling': 'リサンプル',
  'audioProfessional.badge.sampleMismatch': 'サンプルレート不一致',
  'audioProfessional.badge.warning': 'デバイス警告',
  'audioProfessional.issue.reason': '理由',
  'audioProfessional.issue.audioLevelClipped': 'リアルタイムレベルでクリップを検出しました。プリアンプを下げるか、ゲイン系 DSP をオフにしてください。',
  'audioProfessional.issue.audioLevelClippingRisk': 'リアルタイムレベルが 0 dBFS に近く、クリップの危険があります。',
  'audioProfessional.issue.dspClippingRisk': 'DSP チェーン出力にクリップの危険があります。Protect limiter は待機監視中です。',
  'audioProfessional.issue.dspLimiterProtecting': 'Protect limiter が出力を保護しています。DSP 後段の信号が安全しきい値を超えています。',
  'audioProfessional.issue.roomCorrectionBitPerfectDisabled': 'ルーム補正は bit-perfect 出力を無効にします。',
  'audioProfessional.issue.roomCorrectionClippingRisk': 'ルーム補正の出力にクリップの危険があります。FIR Trim を下げるか Auto Gain を有効にしてください。',
  'audioProfessional.issue.sharedMixRateTooHigh': 'Windows の共有サンプルレートが高すぎます。デバイスは {deviceRate}、ECHO は現在 {decoderRate} PCM を出力しているため、再生速度が変わる可能性があります。Windows の既定形式を 48 kHz に下げてください。',
  'audioProfessional.issue.windowsDefaultFormatUnusual': 'Windows の既定形式が高めに設定されています。現在は {deviceRate} です。ECHO は通知のみを行い、システム設定は変更しません。48 kHz に変更することをおすすめします。',
  'audioProfessional.group.directDsp': 'Direct / DSP',
  'audioProfessional.group.playbackChain': '再生チェーン',
  'audioProfessional.group.sampleRate': 'サンプルレート',
  'audioProfessional.group.stability': '安定性',
  'audioProfessional.signal.decode': 'デコード',
  'audioProfessional.signal.dsp': 'DSP',
  'audioProfessional.signal.fir': 'FIR',
  'audioProfessional.signal.headroom': 'ヘッドルーム',
  'audioProfessional.signal.native': 'ネイティブ',
  'audioProfessional.signal.output': '出力',
  'audioProfessional.signal.source': 'ソース',  'audioProfessional.row.actualBuffer': '実 buffer',
  'audioProfessional.row.actualDeviceSampleRate': '実デバイスレート',
  'audioProfessional.row.bitDepth': 'ビット深度',
  'audioProfessional.row.bitPerfect': 'Bit-perfect',
  'audioProfessional.row.bitrate': 'ビットレート',
  'audioProfessional.row.buffered': 'バッファ',
  'audioProfessional.row.channelBalance': 'チャンネルバランス',
  'audioProfessional.row.channels': 'チャンネル',
  'audioProfessional.row.clippingProtection': 'クリップ保護',
  'audioProfessional.row.codec': '形式',
  'audioProfessional.row.decodeBackend': 'デコード後端',
  'audioProfessional.row.decoderOutputSampleRate': 'デコード出力',
  'audioProfessional.row.deviceBuffer': 'デバイス buffer',
  'audioProfessional.row.eq': 'EQ',
  'audioProfessional.row.error': 'エラー',
  'audioProfessional.row.fileSampleRate': 'ソースレート',
  'audioProfessional.row.latencyProfile': 'レイテンシ',
  'audioProfessional.row.outputBackend': '出力後端',
  'audioProfessional.row.outputDevice': '出力デバイス',
  'audioProfessional.row.outputLatency': '出力遅延',
  'audioProfessional.row.outputMode': '出力モード',
  'audioProfessional.row.replayGain': 'ReplayGain',
  'audioProfessional.row.protectLimiter': 'Protect limiter',
  'audioProfessional.row.roomCorrection': 'ルーム補正',
  'audioProfessional.row.requestedBuffer': '要求 buffer',
  'audioProfessional.row.requestedOutputSampleRate': '要求出力',
  'audioProfessional.row.resampler': 'リサンプラー',
  'audioProfessional.row.resampling': 'リサンプル',
  'audioProfessional.row.sampleRateMismatch': 'レート不一致',
  'audioProfessional.row.signalPath': '信号パス',
  'audioProfessional.row.sharedDeviceSampleRate': '共有デバイスレート',
  'audioProfessional.row.sharedStability': '共有安定度',
  'audioProfessional.row.soxr': 'SOXR',
  'audioProfessional.row.state': '状態',
  'audioProfessional.row.underrun': 'Underrun',
  'audioProfessional.row.warnings': '警告',
  'audioProfessional.summary.pending': '音声状態を待機中',
  'audioProfessional.title': 'プロ再生ステータス',
  'audioProfessional.value.disabled': 'オフ',
  'audioProfessional.value.dspPath': 'DSP Path: {modules}',
  'audioProfessional.value.enabled': 'オン',
  'audioProfessional.value.nativePath': 'Native Path',
  'audioProfessional.value.no': 'いいえ',
  'audioProfessional.value.pending': '確認中',
  'audioProfessional.value.ready': 'Direct ready',
  'audioProfessional.value.sharedMixer': '共有ミキサー',
  'audioProfessional.value.systemDefault': 'システム既定出力',
  'audioProfessional.value.unknown': 'n/a',
  'audioProfessional.value.yes': 'はい',
  'audioDrawer.todo.outputControls': 'ターゲットレートとバッファー制御',
  'audioDrawer.todo.outputControlsDescription': 'TODO: DeviceService が安全な制御を公開したら実際の音声設定に接続します。',
  'audioDrawer.troubleshooting.description': '音が固まったりデバイス一覧が不正な時に使います。ソフト再起動は他のアプリに影響しません。',
  'audioDrawer.troubleshooting.hardAction': 'Windows Audio サービスを再起動',
  'audioDrawer.troubleshooting.hardBusy': 'Windows Audio サービスを再起動中',
  'audioDrawer.troubleshooting.hardConfirm': 'これはすべてのアプリの音声（Chrome、ゲーム、通話）を中断し、管理者権限が必要です。続行しますか？',
  'audioDrawer.troubleshooting.hardDone': 'Windows Audio サービスが復旧しました。もう一度再生できます',
  'audioDrawer.troubleshooting.softAction': '音声エンジンを再起動',
  'audioDrawer.troubleshooting.softBusy': '音声エンジンを再起動中',
  'audioDrawer.troubleshooting.softDone': '音声エンジンを再起動しました。もう一度再生できます',
  'audioDrawer.troubleshooting.title': '音声トラブルシューティング',
  'folders.action.addScan': '追加してスキャン',
  'folders.action.browse': '参照',
  'folders.action.cancel': 'キャンセル',
  'folders.action.open': '開く',
  'folders.action.play': '再生',
  'folders.action.queue': 'キューに追加',
  'folders.action.random': 'ランダム',
  'folders.action.refresh': 'フォルダーを更新',
  'folders.action.remove': '削除',
  'folders.action.scan': 'スキャン',
  'folders.confirm.deleteTrack': 'この音楽ファイルを削除しますか？\n{title}',
  'folders.confirm.removeRoot': '「{name}」をライブラリインデックスから削除しますか？音楽ファイルはディスク上に残ります。',
  'folders.count.tracks': '{count} 曲',
  'folders.detail.importHint': '音楽フォルダーを取り込むと、パス別にライブラリを閲覧できます。',
  'folders.detail.libraryFolders': 'ライブラリフォルダー',
  'folders.detail.root': 'ルート',
  'folders.detail.selectFolder': 'フォルダーを選択',
  'folders.detail.subfolder': 'サブフォルダー',
  'folders.duration.hours': '{count} 時間',
  'folders.duration.hoursMinutes': '{hours} 時間 {minutes} 分',
  'folders.duration.minutes': '{count} 分',
  'folders.empty.noScan': 'このルートではまだスキャンが実行されていません。',
  'folders.empty.roots': 'ライブラリフォルダーはまだありません。',
  'folders.error.actionFailed': 'フォルダー操作に失敗しました。',
  'folders.error.desktopEditTags': 'デスクトップブリッジを利用できません。ECHO Next デスクトップ版で埋め込みタグを編集してください。',
  'folders.error.desktopFileActions': 'デスクトップブリッジを利用できません。ECHO Next デスクトップ版でファイル操作を使用してください。',
  'folders.error.desktopImport': 'デスクトップブリッジを利用できません。ECHO Next デスクトップ版でフォルダーを取り込んでください。',
  'folders.error.desktopManage': 'デスクトップブリッジを利用できません。ECHO Next デスクトップ版でフォルダーを管理してください。',
  'folders.error.noCoverSaved': '保存されたカバーアートはありません。',
  'folders.error.noCoverToCopy': 'この曲にはコピーできるカバーアートがありません。',
  'folders.error.notFolder': '選択したパスはフォルダーではありません。',
  'folders.error.pathMissing': 'フォルダーパスが存在しません。',
  'folders.error.permission': 'ECHO にはこのフォルダーへアクセスする権限がありません。',
  'folders.error.trackActionUnavailable': 'この曲の操作はまだ利用できません。',
  'folders.filters.includeSubfolders': 'サブフォルダーを含める',
  'folders.filters.label': 'フォルダー内の曲フィルター',
  'folders.filters.searchPlaceholder': 'このフォルダーを検索...',
  'folders.message.addedToPlaylist': 'プレイリストに追加しました: {name}',
  'folders.message.alreadyScanning': 'このライブラリルートはすでにスキャン中です。',
  'folders.message.folderAddedScanStarted': 'フォルダーを追加しました。スキャンはバックグラウンドで開始されました。',
  'folders.message.folderRemoved': 'フォルダーをライブラリインデックスから削除しました。',
  'folders.message.loadedPartial': 'メモリ使用量を抑えるため、{total} 曲中 {loaded} 曲を読み込みました。',
  'folders.message.loadedTracks': '{count} 曲を読み込みました。',
  'folders.message.noPlayableTracks': 'このフォルダーには再生可能な曲がありません。',
  'folders.message.queuedTracks': '{count} 曲をキューに追加しました。',
  'folders.message.scanCancelled': 'スキャンをキャンセルしました。',
  'folders.message.scanStarted': 'スキャンを開始しました。',
  'folders.metrics.duration': '再生時間',
  'folders.metrics.label': 'フォルダー指標',
  'folders.metrics.size': 'サイズ',
  'folders.metrics.subfolders': 'サブフォルダー',
  'folders.metrics.tracks': '曲',
  'folders.panel.addFolder': 'フォルダーを追加',
  'folders.panel.import': '取り込み',
  'folders.panel.manage': '管理',
  'folders.panel.scan': 'スキャン',
  'folders.panel.selectedRoot': '選択中のルート',
  'folders.panel.status': '状態',
  'folders.phase.checkingCache': 'キャッシュ確認',
  'folders.phase.discovering': 'ファイル検索',
  'folders.phase.extractingCovers': 'カバー抽出',
  'folders.phase.finished': '完了',
  'folders.phase.groupingAlbums': 'アルバム整理',
  'folders.phase.readingMetadata': 'タグ読み込み',
  'folders.phase.writingDatabase': 'データベース書き込み',
  'folders.prompt.choosePlaylist': 'プレイリスト番号を選択:\n{names}',
  'folders.prompt.createPlaylist': 'プレイリストがまだありません。作成する名前を入力してください:',
  'folders.queueSource.recursive': '{name} フォルダー',
  'folders.scan.progress': '{processed}/{total} ファイル、エラー {errors} 件',
  'folders.sidebar.kicker': 'ライブラリ',
  'folders.sidebar.title': 'フォルダー',
  'folders.sort.album': 'アルバム',
  'folders.sort.artist': 'アーティスト',
  'folders.sort.duration': '再生時間',
  'folders.sort.quality': '音質',
  'folders.sort.random': 'ランダム',
  'folders.sort.recent': '最近更新',
  'folders.sort.title': 'タイトル',
  'folders.status.cancelled': 'キャンセル済み',
  'folders.status.completed': '完了',
  'folders.status.failed': '失敗',
  'folders.status.queued': '待機中',
  'folders.status.running': 'スキャン中',
  'folders.statusLine.loadingTracks': 'フォルダー内の曲を読み込み中...',
  'folders.statusLine.preparingQueue': 'フォルダーキューを準備中...',
  'common.available': '利用可能',
  'common.build': 'ビルド',
  'common.checking': '確認中',
  'common.dev': '開発版',
  'common.disabled': '無効',
  'common.enabled': '有効',
  'common.loading': '読み込み中',
  'common.na': 'なし',
  'common.no': 'いいえ',
  'common.ready': '準備完了',
  'common.unavailable': '現在利用不可',
  'common.yes': 'はい',
  'notice.browserFolderPicker': 'ブラウザプレビューでフォルダ選択を開きました。実際のライブラリ取り込みは Electron デスクトップアプリで行います。',
  'notice.browserFilePicker': 'ブラウザプレビューで {name} を選択しました。ECHO Next デスクトップ版で Audio Core から再生してください。',
  'notice.windowControlsDesktop': 'ウィンドウ操作は Electron デスクトップウィンドウでのみ利用できます。',
  'route.albums.description': 'アルバム別のウォール表示。',
  'route.albums.label': 'アルバム',
  'route.artists.description': 'アーティスト別に閲覧。',
  'route.artists.label': 'アーティスト',
  'route.audioSettings.description': '出力とデコーダー設定。',
  'route.audioSettings.label': '音声設定',
  'route.connect.description': 'DLNA / AirPlay ワイヤレス再生。',
  'route.connect.label': '接続',
  'route.dsp.description': '信号チェーン調整ワークベンチ。',
  'route.dsp.label': 'DSP',
  'connectPage.controls.aria': 'Connect controls',
  'connectPage.controls.disconnect': '切断',
  'connectPage.controls.pause': '一時停止',
  'connectPage.controls.play': '再生',
  'connectPage.controls.stop': '停止',
  'connectPage.controls.volume': 'キャスト音量',
  'connectPage.deviceState.available': '利用可能',
  'connectPage.deviceState.connected': '接続済み',
  'connectPage.deviceState.unavailable': 'オフライン',
  'connectPage.deviceState.unsupported': '実験',
  'connectPage.devices.allHidden': '現在のデバイスはすべて非表示です',
  'connectPage.devices.aria': 'デバイス一覧',
  'connectPage.devices.collapse': 'ローカルネットワークストリーマーを折りたたむ',
  'connectPage.devices.empty': 'ローカルネットワーク機器は見つかりません',
  'connectPage.devices.emptyHint': '更新すると、ここにストリーマー、TV、HQPlayer、AirPlay の入口が表示されます。',
  'connectPage.devices.expand': 'ローカルネットワークストリーマーを展開',
  'connectPage.devices.hiddenAria': '非表示のローカルネットワーク機器',
  'connectPage.devices.hiddenTitle': '非表示の機器',
  'connectPage.devices.kicker': 'NETWORK STREAMERS',
  'connectPage.devices.restoreAll': 'すべて再表示',
  'connectPage.devices.restoreHint': '上で非表示の機器を再表示できます。',
  'connectPage.devices.summary': '{streamers} 台のストリーマー · {entries} 個の入口 · 非表示 {hidden}',
  'connectPage.devices.title': 'ローカルネットワーク再生',
  'connectPage.header.autoStart': '起動時に AirPlay / DLNA を自動で有効化',
  'connectPage.header.description': 'DLNA / AirPlay / HQPlayer の外部再生をまとめて管理します。HQPlayer は現在、安全な引き継ぎ確認を主目的にしています。',
  'connectPage.header.kicker': 'WIRELESS PLAYBACK',
  'connectPage.header.refresh': 'デバイスを更新',
  'connectPage.hqplayer.enable': 'HQPlayer を有効化',
  'connectPage.hqplayer.kicker': 'EXTERNAL RENDERER',
  'connectPage.hqplayer.localDesktop': 'この PC の HQPlayer Desktop',
  'connectPage.hqplayer.state.available': '接続可能',
  'connectPage.hqplayer.state.checking': '確認中',
  'connectPage.hqplayer.state.disabled': '無効',
  'connectPage.hqplayer.state.notConfigured': 'ポート未設定',
  'connectPage.hqplayer.state.unavailable': '利用不可',
  'connectPage.hqplayer.test': 'HQPlayer を検出',
  'connectPage.nowPlaying.aria': '現在のキャスト',
  'connectPage.nowPlaying.chooseDevice': 'ローカルネットワークストリーマーを選ぶとキャストを開始できます',
  'connectPage.nowPlaying.coverReady': 'カバー URL 送信済み',
  'connectPage.nowPlaying.coverWaiting': 'カバー URL を待機中',
  'connectPage.nowPlaying.dlnaPolling': '状態ポーリングは約 3 秒',
  'connectPage.nowPlaying.emptyTitle': '現在の曲はありません',
  'connectPage.nowPlaying.infoAria': '現在のキャスト情報',
  'connectPage.nowPlaying.infoWaiting': 'キャスト情報を待機中',
  'connectPage.nowPlaying.latency': 'キャスト握手 {ms}ms',
  'connectPage.nowPlaying.noOutput': '出力未接続',
  'connectPage.nowPlaying.progressAria': 'キャスト進行状況',
  'connectPage.outgoing.aria': 'DLNA outgoing request log',
  'connectPage.outgoing.empty': 'No pulls yet',
  'connectPage.outgoing.note': 'デバイスがカバーや音声を取得すると、ここに表示されます。',
  'connectPage.outgoing.recent': '{count} recent',
  'connectPage.outgoing.title': 'DLNA Out',
  'connectPage.receiver.aria': 'スマホから受信',
  'connectPage.receiver.disable': '受信を停止',
  'connectPage.receiver.discoveryHint': '有効にするとスマホから見つけられます',
  'connectPage.receiver.enable': '受信を開始',
  'connectPage.receiver.fromClient': '{address} から',
  'connectPage.receiver.kicker': 'RECEIVER',
  'connectPage.receiver.noClient': 'スマホ未接続',
  'connectPage.receiver.preparing': 'ローカルネットワークのアドレスを準備中',
  'connectPage.receiver.progressAria': '受信再生の進行状況',
  'connectPage.receiver.state.disabled': '未開始',
  'connectPage.receiver.state.idle': 'スマホ待機中',
  'connectPage.receiver.state.loading': '読み込み中',
  'connectPage.receiver.state.playing': 'スマホから再生中',
  'connectPage.receiver.state.ready': 'メディアを受信済み',
  'connectPage.receiver.stop': '受信再生を停止',
  'connectPage.receiver.title': 'スマホから受信',
  'connectPage.receiver.waitingTitle': 'スマホからの送信を待機中',
  'connectPage.stage.aria': 'クイックキャスト',
  'connectPage.state.connecting': '接続中',
  'connectPage.state.discovering': '機器をスキャン中',
  'connectPage.state.error': 'エラー',
  'connectPage.state.idle': '待機',
  'connectPage.state.paused': '一時停止中',
  'connectPage.state.playing': 'キャスト中',
  'connectPage.state.stopped': '停止済み',
  'connectPage.airplay.state.idle': 'iPhone を待機中',
  'connectPage.airplay.state.playing': 'AirPlay 再生中',
  'connectPage.airplay.state.starting': '起動中',
  'connectPage.airplay.state.unavailable': 'ネイティブバックエンド利用不可',
  'connectPage.airplay.waitingTitle': 'iPhone からの送信を待機中',
  'route.downloads.description': 'ダウンロードタスクのプレースホルダー。',
  'route.downloads.label': 'ダウンロード',
  'route.folders.description': 'ローカル取り込み元。',
  'route.folders.label': 'フォルダ',
  'route.history.description': '再生履歴。',
  'route.history.label': '履歴',
  'historyPage.action.clear': '履歴を消去',
  'historyPage.action.refreshInvalid': '無効な曲を更新',
  'historyPage.confirm.clear': '再生履歴を消去しますか？音楽ファイルやライブラリ自体は削除されません。',
  'historyPage.date.none': 'まだありません',
  'historyPage.duration.hoursMinutes': '{hours} 時間 {minutes} 分',
  'historyPage.duration.minutes': '{count} 分',
  'historyPage.empty.description': '1 曲再生すると、ここに最近のリスニングが記録されます。',
  'historyPage.empty.title': '再生履歴はまだありません。',
  'historyPage.error.desktopBridgeRead': 'Desktop bridge unavailable. Open ECHO Next in Electron to read playback history.',
  'historyPage.filter.all': 'すべて',
  'historyPage.filter.completed': '完走のみ',
  'historyPage.filter.month': '今月',
  'historyPage.filter.today': '今日',
  'historyPage.filter.week': '今週',
  'historyPage.header.kicker': '最近の再生履歴',
  'historyPage.header.title': '履歴',
  'historyPage.list.aria': '再生履歴一覧',
  'historyPage.list.doubleClick': 'ダブルクリックで再生',
  'historyPage.list.source': '{source} から',
  'historyPage.list.unknownAlbum': '不明なアルバム',
  'historyPage.list.unknownArtist': '不明なアーティスト',
  'historyPage.list.unknownSource': 'ソース不明',
  'historyPage.loadMore': 'さらに読み込む',
  'historyPage.loading': '再生履歴を読み込んでいます...',
  'historyPage.loadingMore': '読み込み中...',
  'historyPage.metric.plays': '{count} 回',
  'historyPage.metric.tracks': '{count} 曲',
  'historyPage.refresh.none': '無効な履歴の曲は見つかりませんでした。',
  'historyPage.refresh.removed': '無効な履歴の曲を {count} 曲削除しました。',
  'historyPage.refresh.running': '更新中...',
  'historyPage.recent.aria': '最近再生した曲リスト',
  'historyPage.recent.count': '最近 {count} 曲',
  'historyPage.recent.empty': '最近再生した曲はまだありません。',
  'historyPage.recent.kicker': '時間順',
  'historyPage.recent.title': '最近再生した曲',
  'historyPage.search.placeholder': 'タイトル、アーティスト、アルバム、パスを検索',
  'historyPage.summary.all.count': '総再生',
  'historyPage.summary.all.duration': '総再生時間',
  'historyPage.summary.all.group': '再生回数順',
  'historyPage.summary.all.latest': '最近の再生日時',
  'historyPage.summary.all.tracks': '履歴の曲数',
  'historyPage.summary.aria': '履歴の概要',
  'historyPage.summary.completed.count': '完走再生',
  'historyPage.summary.completed.duration': '完走再生時間',
  'historyPage.summary.completed.group': '完走回数順',
  'historyPage.summary.completed.latest': '最近の完走再生',
  'historyPage.summary.completed.tracks': '完走した曲数',
  'historyPage.summary.month.count': '今月の再生',
  'historyPage.summary.month.duration': '今月の再生時間',
  'historyPage.summary.month.group': '今月の再生回数順',
  'historyPage.summary.month.latest': '今月の最新再生',
  'historyPage.summary.month.tracks': '今月の曲数',
  'historyPage.summary.today.count': '今日の再生',
  'historyPage.summary.today.duration': '今日の再生時間',
  'historyPage.summary.today.group': '今日の再生回数順',
  'historyPage.summary.today.latest': '今日の最新再生',
  'historyPage.summary.today.tracks': '今日の曲数',
  'historyPage.summary.week.count': '今週の再生',
  'historyPage.summary.week.duration': '今週の再生時間',
  'historyPage.summary.week.group': '今週の再生回数順',
  'historyPage.summary.week.latest': '今週の最新再生',
  'historyPage.summary.week.tracks': '今週の曲数',
  'historyPage.toolbar.aria': '履歴フィルター',
  'route.home.description': 'ライブラリ概要と最近のリスニング。',
  'route.home.label': 'ホーム',
  'home.artistLeaderboard.aria': 'アーティストランキング',
  'home.artistLeaderboard.completionRate': '完走 {rate}%',
  'home.artistLeaderboard.emptyDescription': 'もっと再生すると、ここにあなたの高頻度アーティストが並びます。',
  'home.artistLeaderboard.emptyTitle': 'アーティストランキングはまだありません',
  'home.artistLeaderboard.playCount': '{count} 回',
  'home.artistLeaderboard.title': 'アーティストランキング',
  'home.count.tracks': '{count} 曲',
  'home.date.none': 'まだ記録はありません',
  'home.date.unknown': '日時不明',
  'home.duration.hoursMinutes': '{hours} 時間 {minutes} 分',
  'home.duration.hoursOnly': '{hours} 時間',
  'home.duration.minutes': '{count} 分',
  'home.duration.zeroMinutes': '0 分',
  'home.error.albumNotFound': 'アルバムが見つかりません: {album}',
  'home.error.artistNotFound': 'アーティストが見つかりません: {artist}',
  'home.error.desktopBridgeRandom': 'デスクトップライブラリブリッジを利用できません。ECHO Next デスクトップ版でランダムキューを作成してください。',
  'home.error.desktopBridgeRecommend': 'デスクトップライブラリブリッジを利用できません。ECHO Next デスクトップ版でおすすめを更新してください。',
  'home.error.desktopBridgeView': 'デスクトップライブラリブリッジを利用できません。ECHO Next デスクトップ版でホームを開いてください。',
  'home.favoriteAlbums.aria': 'お気に入りのアルバム',
  'home.favoriteAlbums.emptyDescription': 'もっとアルバムを再生すると、再生回数上位 4 枚がここに表示されます。',
  'home.favoriteAlbums.emptyTitle': 'まだよく聴くアルバムはありません',
  'home.favoriteAlbums.title': 'お気に入りのアルバム',
  'home.hero.action.continue': '再開',
  'home.hero.action.viewQueue': 'キューを見る',
  'home.hero.aria': 'Today Echo',
  'home.hero.defaultTitle': 'あなたのライブラリから再生を始めましょう。',
  'home.hero.description.empty': '音楽を取り込むと、ここがライブラリの入口と最近の再生、本週のリスニングパルスになります。',
  'home.hero.description.resume': '{artist} の「{title}」から再開するか、最近追加したカバーから始めましょう。',
  'home.hero.kicker': 'Today Echo',
  'home.hero.nowPlaying': '再生中',
  'home.hero.recentSignal': '最近のシグナル',
  'home.hero.statsAria': 'ライブラリ統計',
  'home.metric.albums': 'アルバム',
  'home.metric.albumsDetail': '作品単位で集計',
  'home.metric.artists': 'アーティスト',
  'home.metric.folders': 'フォルダ',
  'home.metric.foldersDetail': '最近のスキャン {date}',
  'home.metric.openAria': '{label} を開く',
  'home.metric.songs': '曲',
  'home.metric.songsDetail': '合計 {duration}',
  'home.month.label': '{month}月',
  'home.nowMeta.empty': 'ライブラリの準備ができると最近の内容がここに表示されます',
  'home.preferences.aria': '再生傾向',
  'home.recent.emptyAddedDescription': 'フォルダを取り込むと、最新で追加されたアルバムカバーがここに表示されます。',
  'home.recent.emptyAddedTitle': '最近追加した作品はまだありません',
  'home.recent.emptyPlayedDescription': '再生を始めると、最近聴いたアルバムがここに並びます。',
  'home.recent.emptyPlayedTitle': '最近の再生はまだありません',
  'home.recent.nextPage': '次のページ',
  'home.recent.prevPage': '前のページ',
  'home.recent.tab.added': '追加日',
  'home.recent.tab.played': '再生済み',
  'home.recent.tabsAria': '最近の内容',
  'home.recent.title': '最近のアクティビティ',
  'home.recommend.emptyDescription': 'アルバムを取り込むと、ここにおすすめのアルバムが並びます。',
  'home.recommend.emptyTitle': 'おすすめできるアルバムはまだありません',
  'home.recommend.refresh': '更新',
  'home.recommend.refreshing': '更新中',
  'home.recommend.title': 'おすすめ',
  'home.signalVisualizer.aria': 'オーディオビジュアライザー',
  'home.status.loading': 'ホームを整えています...',
  'home.week.emptyHint': '再生すると、週ごとのリズムでマスが光ります。',
  'home.week.listenDuration': '再生時間',
  'home.week.playCount': '今週の再生',
  'home.week.times': '回',
  'home.week.title': '今週の Echo',
  'home.weekday.fri': '金',
  'home.weekday.mon': '月',
  'home.weekday.wed': '水',
  'home.weeklyHeatmap.activeWeeks': '{count} 週間アクティブ',
  'home.weeklyHeatmap.aria': '直近 {weeks} 週間の再生ヒートマップ',
  'home.weeklyHeatmap.dayAria': '{date}、{playCount} 回再生',
  'home.weeklyHeatmap.dayTitle': '{date} · {playCount} 回 · {duration}',
  'route.inbox.description': '各スキャンで追加された新しい曲。',
  'route.inbox.label': '受信箱',
  'inboxPage.action.addToQueue': 'キューに追加',
  'inboxPage.action.generatePlaylist': 'あとで聴くプレイリストを作成',
  'inboxPage.batch.latest': '最新スキャン',
  'inboxPage.batch.recentAll': '最近の全スキャン',
  'inboxPage.batch.selected': '指定したスキャン',
  'inboxPage.date.none': 'まだ記録はありません',
  'inboxPage.empty.description': 'ライブラリを一度スキャンすると、ここに新しく追加された曲が表示されます。',
  'inboxPage.empty.noMatch': '一致する新着曲はありません',
  'inboxPage.empty.title': '追加記録はまだありません',
  'inboxPage.empty.tryFilter': '別の条件で試してみてください。',
  'inboxPage.error.desktopBridgeRead': 'デスクトップブリッジを利用できないため、新曲受信箱を読み取れません。',
  'inboxPage.facets.allAlbums': 'すべてのアルバム',
  'inboxPage.facets.allArtists': 'すべてのアーティスト',
  'inboxPage.facets.allFolders': 'すべてのフォルダ',
  'inboxPage.facets.aria': '新曲受信箱の軸フィルター',
  'inboxPage.filter.all': 'すべての新着',
  'inboxPage.filter.aria': '問題分類フィルター',
  'inboxPage.filter.clear': 'フィルターをクリア',
  'inboxPage.filter.metadataIssue': 'メタデータ異常',
  'inboxPage.filter.missingCover': 'カバー不足',
  'inboxPage.filter.suspiciousFile': '疑わしいファイル',
  'inboxPage.filter.unknownAlbum': '不明なアルバム',
  'inboxPage.filter.unknownArtist': '不明なアーティスト',
  'inboxPage.hero.kicker': 'LIBRARY INBOX',
  'inboxPage.loading': '受信箱を読み込んでいます...',
  'inboxPage.processing.aria': '今回の保留項目',
  'inboxPage.processing.pending': 'あとで聴く / 未処理',
  'inboxPage.quality.aria': '取り込み品質の概要',
  'inboxPage.quality.coverCompleteness': 'カバー完全率',
  'inboxPage.quality.metadataCompleteness': '情報完全率',
  'inboxPage.quality.unknownArtistAlbum': '不明なアーティスト / アルバム',
  'inboxPage.search.aria': '新曲受信箱を検索',
  'inboxPage.search.placeholder': 'タイトル、アーティスト、アルバム、パスを検索',
  'inboxPage.stats.aria': '新曲受信箱の概要',
  'inboxPage.stats.currentResults': '現在の結果',
  'inboxPage.stats.newSongs': '新着曲',
  'inboxPage.status.all': 'すべての状態',
  'inboxPage.status.aria': '処理状態フィルター',
  'inboxPage.status.ignored': '無視済み',
  'inboxPage.status.pending': '未処理',
  'inboxPage.status.processed': '処理済み',
  'inboxPage.story.aria': '取り込みストーリー',
  'inboxPage.story.clean': '{summary}。全体としてきれいに整っています。',
  'inboxPage.story.empty': 'スキャンが完了すると、ECHO が新着曲、アルバム、メタデータの問題をここに整理します。',
  'inboxPage.story.kicker': 'IMPORT STORY',
  'inboxPage.story.newAlbums': '新着アルバム',
  'inboxPage.story.newArtists': '新着アーティスト',
  'inboxPage.story.summaryAlbums': '{count} 枚のアルバム',
  'inboxPage.story.summaryArtists': '{count} 人のアーティスト',
  'inboxPage.story.summaryTracks': '{scope}で {count} 曲追加',
  'inboxPage.story.totalDuration': '総再生時間',
  'inboxPage.story.warningMetadataIssue': '{count} 曲でメタデータ異常',
  'inboxPage.story.warningMissingCover': '{count} 曲でカバー不足',
  'inboxPage.story.withWarnings': '{summary}。このうち {warnings}。',
  'inboxPage.toolbar.aria': '新曲受信箱フィルター',
  'inboxPage.toolbar.batch': 'バッチ',
  'route.importFile.description': '音声ファイルを 1 件取り込む。',
  'route.importFile.label': 'ファイルを取り込む',
  'route.importFolder.description': 'ローカル音楽フォルダを選択。',
  'route.importFolder.label': 'フォルダを取り込む',
  'importFolder.hero.note': 'このページはローカルライブラリへの取り込みとスキャン状態の確認に使います。',
  'nowPlaying.action.openLyrics': '歌詞を開く',
  'nowPlaying.description': '現在の曲の概要です。歌詞は下部プレイヤーのマイクボタンから専用ページを開いてください。',
  'nowPlaying.emptyDescription': '曲リストやアルバムから再生を始めると、ここに現在の曲が表示されます。',
  'nowPlaying.emptyTitle': '再生中の曲はありません',
  'nowPlaying.kicker': '再生中',
  'nowPlaying.localFile': 'ローカルファイル',
  'nowPlaying.ready': '準備完了',
  'nowPlaying.state.idle': '待機中',
  'nowPlaying.state.playing': '再生中',
  'nowPlaying.title': '再生中',
  'route.liked.description': '保存した曲。',
  'route.liked.label': 'お気に入り',
  'route.lyrics.description': '歌詞と没入再生。',
  'route.lyrics.label': '歌詞',
  'route.lyricsSettings.description': '歌詞の設定。',
  'route.lyricsSettings.label': '歌詞設定',
  'lyricsSettings.action.choose': '選択',
  'lyricsSettings.action.fonts': 'フォント',
  'lyricsSettings.action.match': 'マッチ',
  'lyricsSettings.action.music': '音楽',
  'lyricsSettings.action.reset': 'リセット',
  'lyricsSettings.action.search': '検索',
  'lyricsSettings.background.blur': '背景のぼかし',
  'lyricsSettings.background.brightness': '背景の明るさ',
  'lyricsSettings.background.chooseWallpaper': 'カスタム壁紙を選択',
  'lyricsSettings.background.clearWallpaper': 'カスタム壁紙を削除',
  'lyricsSettings.background.clearWallpaperHint': 'テーマ連動へ戻す',
  'lyricsSettings.background.highResolutionCover': 'ネットワークメタデータから高解像度カバーを取得',
  'lyricsSettings.background.highResolutionCoverDescription': 'カバー連動時だけ一時的に高解像度カバーを歌詞背景として取得します。オフの場合はローカルカバーのみを使います。',
  'lyricsSettings.background.mode.cover': 'カバーに合わせる',
  'lyricsSettings.background.mode.coverColor': 'カバー色',
  'lyricsSettings.background.mode.customWallpaper': 'カスタム壁紙',
  'lyricsSettings.background.mode.theme': 'テーマに合わせる',
  'lyricsSettings.background.modeAria': '歌詞背景モード',
  'lyricsSettings.background.modeDescription': 'カバーモードは現在の曲のカバーを使います。カバー色は主色だけを抽出します。カスタム壁紙はアプリデータフォルダーに保存されます。',
  'lyricsSettings.background.opacity': '背景の透明度',
  'lyricsSettings.background.readability': '歌詞の読みやすさを強化',
  'lyricsSettings.background.readabilityDescription': '没入 MV 背景上の歌詞に縁取りと影を追加します。没入 MV 背景設定を展開しなくても常時切り替えできます。',
  'lyricsSettings.background.scale': '背景の拡大',
  'lyricsSettings.background.showControls': '歌詞背景設定を表示',
  'lyricsSettings.background.smartReadable': 'スマート可読色',
  'lyricsSettings.background.smartReadableDescription': 'カバー、壁紙、MV 画面に合わせて高コントラストの文字色を自動選択し、必要に応じて薄いマスク、縁取り、影を追加します。オフの場合は手動の歌詞色を使います。',
  'lyricsSettings.background.title': '歌詞背景',
  'lyricsSettings.background.tuning': '背景調整',
  'lyricsSettings.background.tuningDescription': 'カバー連動とカスタム壁紙の両方で、ここにある透明度、ぼかし、明るさを使います。',
  'lyricsSettings.background.wallpaperSaved': 'アプリ壁紙フォルダーに保存済み',
  'lyricsSettings.candidate.allSources': 'すべてのソース',
  'lyricsSettings.candidate.results': '歌詞検索結果',
  'lyricsSettings.candidate.risk.high': '確認が必要',
  'lyricsSettings.candidate.risk.low': '高精度一致',
  'lyricsSettings.candidate.risk.medium': '一致の可能性',
  'lyricsSettings.candidate.reason.albumMatch': 'アルバム一致',
  'lyricsSettings.candidate.reason.artistExact': 'アーティスト一致',
  'lyricsSettings.candidate.reason.artistMismatch': 'アーティスト不一致',
  'lyricsSettings.candidate.reason.autoAccept': '自動採用',
  'lyricsSettings.candidate.reason.candidateOnlyCover': 'カバー要確認',
  'lyricsSettings.candidate.reason.candidateOnlyDuration': '長さ要確認',
  'lyricsSettings.candidate.reason.coverIntent': 'カバー候補',
  'lyricsSettings.candidate.reason.durationClose': '長さ近い',
  'lyricsSettings.candidate.reason.durationExact': '長さ一致',
  'lyricsSettings.candidate.reason.durationMismatch': '長さ不一致',
  'lyricsSettings.candidate.reason.embeddedTag': '埋め込み歌詞',
  'lyricsSettings.candidate.reason.localSidecar': 'ローカル歌詞',
  'lyricsSettings.candidate.reason.rejectedByUser': '拒否済み',
  'lyricsSettings.candidate.reason.syncedDurationSafe': '同期安全',
  'lyricsSettings.candidate.reason.titleExact': 'タイトル一致',
  'lyricsSettings.candidate.reason.titleSimilar': 'タイトル類似',
  'lyricsSettings.candidate.reason.versionConflict': 'バージョン衝突',
  'lyricsSettings.candidate.reason.versionMatch': 'バージョン一致',
  'lyricsSettings.candidate.sourceFilters': '歌詞ソースフィルター',
  'lyricsSettings.candidate.type.instrumental': 'インストゥルメンタル',
  'lyricsSettings.candidate.type.lyrics': '歌詞',
  'lyricsSettings.candidate.type.plain': 'プレーン',
  'lyricsSettings.candidate.type.synced': '同期歌詞',
  'lyricsSettings.currentTrack.instrumentalMarked': 'インストゥルメンタルとして設定済み',
  'lyricsSettings.currentTrack.markInstrumental': 'インストゥルメンタルに設定',
  'lyricsSettings.currentTrack.markInstrumentalHint': '現在の曲を記憶し、自動歌詞マッチングを停止します',
  'lyricsSettings.currentTrack.rematch': '再マッチ',
  'lyricsSettings.currentTrack.rematchHint': '現在のキャッシュを消して再検索します',
  'lyricsSettings.currentTrack.restartOnApply': '歌詞適用後に自動で再生し直す',
  'lyricsSettings.currentTrack.restartOnApplyDescription': '既定はオフです。オンにすると、現在の曲へ歌詞を適用した後に先頭から再生し、新しいタイムラインで同期し直します。',
  'lyricsSettings.currentTrack.searchHint': '空欄なら現在の曲情報を使います',
  'lyricsSettings.currentTrack.searchInput': '歌詞検索テキスト',
  'lyricsSettings.currentTrack.searchLyrics': '歌詞を検索',
  'lyricsSettings.currentTrack.searchPlaceholder': '曲名 / アーティスト / キーワード',
  'lyricsSettings.currentTrack.title': '現在の曲',
  'lyricsSettings.display.autoOpenCandidatePanel': '歌詞選択パネルを自動表示',
  'lyricsSettings.display.chooseMiniPlayerColor': '下部バーの色を選択',
  'lyricsSettings.display.coverMiniPlayerHint': '現在の曲のカバーから色を抽出し、ボタンが読みやすい暗めのガラス色に調整します。',
  'lyricsSettings.display.customColor': 'カスタム色',
  'lyricsSettings.display.defaultMicrosoftYahei': '既定は Microsoft YaHei。システムフォントに変更できます',
  'lyricsSettings.display.desktopFont': 'デスクトップ歌詞フォント',
  'lyricsSettings.display.desktopLyrics': 'デスクトップ歌詞',
  'lyricsSettings.display.desktopLyricsDescription': '独立した透明ウィンドウで現在の歌詞をデスクトップ最前面に表示します。',
  'lyricsSettings.display.desktopOpacity': 'デスクトップ歌詞の透明度',
  'lyricsSettings.display.desktopOpacityDescription': '現在 {opacity}%。下げると画面を遮りにくくなります。',
  'lyricsSettings.display.desktopRomanization': 'デスクトップ歌詞にローマ字を表示',
  'lyricsSettings.display.desktopTranslation': 'デスクトップ歌詞に翻訳を表示',
  'lyricsSettings.display.disableMvTrackInfoAutoShow': 'MV で曲情報を自動表示しない',
  'lyricsSettings.display.enableLyrics': '歌詞を有効化',
  'lyricsSettings.display.enableLyricsDescription': 'オフにすると歌詞ページは歌詞を読み込み、検索、マッチングしません。',
  'lyricsSettings.display.hideEmptyState': 'インストゥルメンタル表示を隠す',
  'lyricsSettings.display.hideEmptyStateDescription': '歌詞ページ中央のインストゥルメンタル表示と歌詞なし表示を隠します。既定はオンです。',
  'lyricsSettings.display.hideTrackInfo': '曲情報を隠す',
  'lyricsSettings.display.lockDesktopLyrics': 'デスクトップ歌詞をロック',
  'lyricsSettings.display.lockDesktopLyricsDescription': 'ロックするとマウスがデスクトップ歌詞を通過し、操作の邪魔を防ぎます。ここで解除できます。',
  'lyricsSettings.display.matchThreshold': '歌詞一致度設定',
  'lyricsSettings.display.matchThresholdDescription': 'オンライン結果が {threshold}% 以上の場合だけ自動適用します',
  'lyricsSettings.display.miniPlayer': 'ミニ下部バー',
  'lyricsSettings.display.miniPlayerAutoHide': 'ミニ下部バーを自動で隠す',
  'lyricsSettings.display.miniPlayerAutoHideDescription': 'オンにすると、ポインターが下部バーから離れた時に自動で隠れ、下部付近へ戻ると滑らかに表示します。既定はオフです。',
  'lyricsSettings.display.miniPlayerAutoMv': 'MV 再生時に自動で有効化',
  'lyricsSettings.display.miniPlayerAutoMvDescription': 'オンにすると MV ページではミニ下部バーを自動で使い、通常の歌詞ページでは上の設定に従います。',
  'lyricsSettings.display.miniPlayerColor': '下部バーの色',
  'lyricsSettings.display.miniPlayerColorMode': 'ミニ下部バーの色モード',
  'lyricsSettings.display.miniPlayerDefaultDark': '既定のダーク',
  'lyricsSettings.display.miniPlayerDescription': 'オンにすると歌詞ページの既定の下部再生バーを隠し、中央下の小さなコントロールバーに置き換えます。',
  'lyricsSettings.display.miniPlayerHint': '既定でオンです。没入感を保ちながら曲送りやシークを素早く使いたい場合に向いています。',
  'lyricsSettings.display.miniPlayerOpacity': '下部バーの透明度',
  'lyricsSettings.display.miniPlayerPalette': 'ミニ下部バー色パレット',
  'lyricsSettings.display.preferUtatenKana': 'UtaTen ふりがなを優先',
  'lyricsSettings.display.preferUtatenKanaDescription': '既定はオフです。オンにすると日本語歌詞は UtaTen のふりがなをローマ字表示の代わりに使い、見つからない場合は自動で戻します。',
  'lyricsSettings.display.resetDesktopPosition': 'デスクトップ歌詞位置をリセット',
  'lyricsSettings.display.resetDesktopPositionHint': '画面下中央へ戻す',
  'lyricsSettings.display.showRomanization': 'ローマ字を表示',
  'lyricsSettings.display.showRomanizationDescription': '歌詞ソース提供のローマ字を優先し、ない場合は日本語歌詞をローカル生成します。',
  'lyricsSettings.display.showTranslation': '中国語翻訳を表示',
  'lyricsSettings.display.showTranslationDescription': '歌詞ソース提供の中国語翻訳を優先し、翻訳がない場合は追加テキストを表示しません。',
  'lyricsSettings.display.title': '歌詞表示',
  'lyricsSettings.display.useMiniPlayerColor': '下部バー色 {color} を使用',
  'lyricsSettings.drawer.aria': '歌詞設定',
  'lyricsSettings.drawer.close': '歌詞設定を閉じる',
  'lyricsSettings.drawer.title': '歌詞設定',
  'lyricsSettings.engine.autoMatch': '自動マッチ',
  'lyricsSettings.engine.provider': 'ソース',
  'lyricsSettings.engine.threshold': 'しきい値',
  'lyricsSettings.engine.title': '歌詞エンジン',
  'lyricsSettings.font.applySystem': 'システムフォントを適用',
  'lyricsSettings.font.chooseInstalled': 'インストール済みフォントを選択',
  'lyricsSettings.font.custom': 'カスタム',
  'lyricsSettings.font.desktopOnly': 'デスクトップ歌詞のみに影響',
  'lyricsSettings.font.importDesktop': 'デスクトップ歌詞フォントを取り込む',
  'lyricsSettings.font.importFile': 'フォントファイルを取り込む',
  'lyricsSettings.font.lyricsOnly': '歌詞ページと歌詞行のみに影響',
  'lyricsSettings.font.restoreDesktopDefault': 'デスクトップ歌詞の既定フォントに戻す',
  'lyricsSettings.font.restoreLyricsDefault': '既定の歌詞フォントに戻す',
  'lyricsSettings.font.system': 'システムフォント',
  'lyricsSettings.fontPicker.aria': '歌詞フォントを選択',
  'lyricsSettings.fontPicker.chooseFile': 'ファイルからフォントを選択',
  'lyricsSettings.fontPicker.close': '歌詞フォント選択を閉じる',
  'lyricsSettings.fontPicker.preview': '歌詞フォントプレビュー Aa こんにちは',
  'lyricsSettings.fontPicker.searchPlaceholder': 'インストール済みフォントを検索',
  'lyricsSettings.fontPicker.title': '歌詞フォントを選択',
  'lyricsSettings.provider.cached': 'キャッシュ歌詞',
  'lyricsSettings.provider.amllTtml': 'AMLL TTML',
  'lyricsSettings.provider.amllTtmlDescription': '単語単位 TTML 歌詞ライブラリ。NetEase ID の照合が必要で、既定では無効です',
  'lyricsSettings.provider.chineseCatalogDescription': '中国語カタログ補完',
  'lyricsSettings.provider.genius': 'Genius',
  'lyricsSettings.provider.kugou': 'KuGou Music',
  'lyricsSettings.provider.kuwo': 'Kuwo Music',
  'lyricsSettings.provider.local': 'ローカル歌詞',
  'lyricsSettings.provider.lrclib': 'LRCLIB',
  'lyricsSettings.provider.lrclibDescription': 'オープン歌詞ライブラリ',
  'lyricsSettings.provider.manual': '手動歌詞',
  'lyricsSettings.provider.musixmatch': 'Musixmatch',
  'lyricsSettings.provider.netease': 'NetEase Cloud Music',
  'lyricsSettings.provider.none': '未適用の歌詞',
  'lyricsSettings.provider.qqmusic': 'QQ Music',
  'lyricsSettings.preview.primary': '歌詞プレビュー',
  'lyricsSettings.preview.secondary': 'サブ歌詞行',
  'lyricsSettings.online.autoSearch': '歌詞を自動マッチ',
  'lyricsSettings.online.autoSearchDescription': 'ローカル歌詞を常に優先します。オンライン結果はしきい値に達した場合だけ自動適用します。',
  'lyricsSettings.online.autoSaveSidecar': 'ローカル歌詞ファイルを自動保存',
  'lyricsSettings.online.autoSaveSidecarDescription': '既定ではオフです。オンラインまたは手動で適用した歌詞を曲と同名のサイドカーファイルとして保存し、既存の .lrc / .ttml / .txt は上書きしません。',
  'lyricsSettings.online.deepSearch': '深度優先検索',
  'lyricsSettings.online.deepSearchDescription': 'オンにすると複数のオンラインプラットフォームを並列検索し、いずれかが自動適用しきい値に達した時点で他のソースを停止して返します。',
  'lyricsSettings.online.enable': 'オンライン歌詞マッチングを有効化',
  'lyricsSettings.online.enableDescription': 'マッチングには曲名、アーティスト、アルバム、長さだけを送信します。',
  'lyricsSettings.online.sources': '歌詞ソース',
  'lyricsSettings.online.sourcesDescription': 'ローカル歌詞を常に優先します。未選択のオンラインソースは自動マッチや再マッチに参加しません。',
  'lyricsSettings.online.title': 'オンラインマッチング',
  'lyricsSettings.status.applied': '歌詞を適用しました',
  'lyricsSettings.status.applying': '適用中',
  'lyricsSettings.status.auto': '自動',
  'lyricsSettings.status.markedInstrumental': 'インストゥルメンタルとして設定しました',
  'lyricsSettings.status.noCandidates': '歌詞候補が見つかりません',
  'lyricsSettings.status.noPlayingTrack': '再生中の曲がありません',
  'lyricsSettings.status.normal': '標準',
  'lyricsSettings.status.off': 'オフ',
  'lyricsSettings.status.on': 'オン',
  'lyricsSettings.status.rematchingCandidates': '歌詞候補を再検索中...',
  'lyricsSettings.status.searchingCandidates': '歌詞候補を検索中...',
  'lyricsSettings.style.chooseLyricsColor': '歌詞色を選択',
  'lyricsSettings.style.contextOpacity': '前後行の透明度',
  'lyricsSettings.style.fontSize': '歌詞フォントサイズ',
  'lyricsSettings.style.lineMaxChars': '1行あたりの文字数',
  'lyricsSettings.style.lineMaxCharsValue': '{count}文字',
  'lyricsSettings.style.lineSpacing': '歌詞行間',
  'lyricsSettings.style.lyricsColor': '歌詞色',
  'lyricsSettings.style.lyricsColorPalette': '歌詞色パレット',
  'lyricsSettings.style.lyricsFont': '歌詞フォント',
  'lyricsSettings.style.secondaryFontSize': 'サブ歌詞フォントサイズ',
  'lyricsSettings.style.showControls': '歌詞スタイル設定を表示',
  'lyricsSettings.style.showControlsDescription': 'サブ歌詞サイズ、歌詞サイズ、行間、前後行の透明度、歌詞色を含みます。',
  'lyricsSettings.style.useColor': '色 {color} を使用',
  'lyricsSettings.timing.defaultOffset': '新しい歌詞の既定遅延',
  'lyricsSettings.timing.globalOffset': '全体遅延',
  'lyricsSettings.timing.restoreDefaults': '歌詞の既定値に戻す',
  'lyricsSettings.timing.restoreDefaultsHint': '一致しきい値 50% / 遅延 0ms',
  'lyricsSettings.timing.showPerTrackOffset': 'この曲の遅延補正を表示',
  'lyricsSettings.timing.smartAlignment': 'スマート歌詞補正',
  'lyricsSettings.timing.smartAlignmentDescription': '信頼度が高い場合は現在の曲の遅延を自動保存します。異常なずれはソース変更の提案だけを行い、元に戻せます。',
  'lyricsSettings.timing.timelineCorrection': '歌詞タイムライン補正を適用',
  'lyricsSettings.timing.timelineCorrectionDescription': '全体遅延はすべての曲に影響します。この曲だけの遅延は歌詞ページの補正バーで調整し、曲ごとに記憶されます。',
  'lyricsSettings.timing.title': 'マッチングと遅延',
  'lyricsSettings.wordHighlight.clarity': '単語ハイライトの明瞭度',
  'lyricsSettings.wordHighlight.clarityDescription': '既定は「標準」です。高くすると現在の単語の未再生部分がより完全に残り、低くすると単語ごとの進行感が強くなります。',
  'lyricsSettings.wordHighlight.description': '歌詞ファイルに実際の単語タイムスタンプがある場合だけ有効です。それ以外は行ハイライトを使います。',
  'lyricsSettings.wordHighlight.title': '単語ごとの歌詞ハイライト',
  'route.mvSettings.description': 'MV の紐付けとローカル検索設定。',
  'route.mvSettings.label': 'MV 設定',
  'mvSettings.action.chooseFile': 'ローカル動画をインポート',
  'mvSettings.action.close': 'MV 設定を閉じる',
  'mvSettings.action.collapseNetwork': 'ネットワークソースを折りたたむ',
  'mvSettings.action.dragReorder': 'ドラッグして優先度を変更',
  'mvSettings.action.dragSource': '{provider} をドラッグして優先度を変更',
  'mvSettings.action.expandNetwork': 'ネットワークソースを展開',
  'mvSettings.action.findLocal': 'ローカル検索',
  'mvSettings.action.openExternal': '選択した MV を外部で開く',
  'mvSettings.action.refresh': '更新',
  'mvSettings.action.removeSelected': '選択した MV を削除',
  'mvSettings.action.searchNetwork': 'ネットワーク MV を検索',
  'mvSettings.aria.candidates': 'MV 候補',
  'mvSettings.aria.drawer': 'MV 設定',
  'mvSettings.aria.engineStatus': 'MV エンジン状態',
  'mvSettings.aria.maxQuality': '最大画質 {quality}',
  'mvSettings.aria.maxQualityOptions': '最大画質オプション',
  'mvSettings.aria.networkSources': 'ネットワークソース優先度',
  'mvSettings.aria.selectedQuality': '選択中 MV 画質 {quality}',
  'mvSettings.aria.selectedQualityOptions': '選択中 MV 画質オプション',
  'mvSettings.badge.credentialsMain': '認証情報はメインに保持',
  'mvSettings.badge.proxyOnly': 'プロキシのみ',
  'mvSettings.binding.selectedMv': '選択中の MV',
  'mvSettings.binding.title': 'MV ソース',
  'mvSettings.candidate.external': '外部',
  'mvSettings.candidate.inApp': 'アプリ内',
  'mvSettings.custom.apply': 'カスタム MV を適用',
  'mvSettings.custom.description': 'YouTube または Bilibili の動画リンクを現在の MV として貼り付けます。',
  'mvSettings.custom.directDash': '直接ストリーム（DASH）',
  'mvSettings.custom.input': 'カスタム MV リンク',
  'mvSettings.custom.placeholder': 'https://youtube.com/watch?v=... または BVxxxxxxxx',
  'mvSettings.custom.playing': '再生中: {provider} - {sourceId}',
  'mvSettings.custom.title': 'カスタム MV',
  'mvSettings.custom.videoTitle': '動画タイトル: {title}',
  'mvSettings.engine.mvTitle': 'MVタイトル',
  'mvSettings.engine.network': 'ネットワーク',
  'mvSettings.engine.quality': '画質',
  'mvSettings.engine.selected': '選択中',
  'mvSettings.engine.title': 'MV エンジン',
  'mvSettings.error.noActiveTrackBinding': 'MV の紐付けに使えるライブラリ曲が選択されていません',
  'mvSettings.error.noActiveTrackMatching': 'MV 検索に使えるライブラリ曲が選択されていません',
  'mvSettings.error.noActiveTrackNetworkSearch': 'ネットワーク MV 検索に使えるライブラリ曲が選択されていません',
  'mvSettings.error.databaseUnavailable': 'MV データベースを一時的に読み取れません。先にライブラリ復旧でデータベースを修復してください。',
  'mvSettings.error.noLocalCandidates': 'ローカル MV 候補が見つかりません',
  'mvSettings.error.noNetworkCandidates': 'ネットワーク MV 候補が見つかりません',
  'mvSettings.general.enabled': 'MV を有効化',
  'mvSettings.immersive.blur': '背景ぼかし',
  'mvSettings.immersive.autoScale': '自動ズーム',
  'mvSettings.immersive.autoScaleDescription': 'MV の縦横比に合わせて背景を拡大し、黒帯をできるだけ避けます。',
  'mvSettings.immersive.brightness': '背景の明るさ',
  'mvSettings.immersive.description': 'オンにすると、歌詞ページで現在の MV を背景として使います。',
  'mvSettings.immersive.dragHint': '歌詞ページの空き領域をドラッグして調整できます。',
  'mvSettings.immersive.hideLyrics': 'MV 画面で歌詞を隠す',
  'mvSettings.immersive.hideLyricsDescription': 'オンにすると、MV 画面では歌詞テキストを表示しません。既定ではオフです。',
  'mvSettings.immersive.lyricsReadability': '歌詞の読みやすさを強化',
  'mvSettings.immersive.lyricsReadabilityDescription': '没入型 MV 上の歌詞にアウトラインと影を追加します。',
  'mvSettings.immersive.overlay': '暗色オーバーレイ',
  'mvSettings.immersive.overlayHint': '低いほど原画に近く、高いほど歌詞が読みやすくなります。',
  'mvSettings.immersive.positionX': '横位置',
  'mvSettings.immersive.positionY': '縦位置',
  'mvSettings.immersive.reset': '没入型背景をリセット',
  'mvSettings.immersive.title': '没入型 MV 背景',
  'mvSettings.immersive.tuning': '没入型背景の調整',
  'mvSettings.immersive.visualHint': '没入型背景の見え方を調整します。',
  'mvSettings.immersive.zoom': '背景ズーム',
  'mvSettings.network.autoApply': 'ネットワーク MV を自動検索',
  'mvSettings.network.autoApplyThreshold': '自動適用の一致度',
  'mvSettings.network.autoApplyThresholdDescription': '候補が {threshold} 以上の場合だけ自動適用します。',
  'mvSettings.network.autoPreload': 'MV をプリロード',
  'mvSettings.network.autoPreloadDescription': 'オンにすると、曲の再生時に現在の曲の MV を事前に検索して準備します。',
  'mvSettings.network.diagnosticsReport': 'MV 診断レポート',
  'mvSettings.network.diagnosticsReportDescription': '既定ではオフです。オンにすると、MV 画面が表示されない時にコピー可能なローカル診断情報を表示します。',
  'mvSettings.network.maxQuality': '最大画質',
  'mvSettings.network.preferHighestViewCount': '再生数でマッチ',
  'mvSettings.network.preferHighestViewCountDescription': 'オンにすると自動検索は曲名とアーティストだけを使い、再生数が最も多い再生可能な MV を優先します。',
  'mvSettings.network.replayAudioOnChange': 'MV 切り替え後に音楽を自動再生',
  'mvSettings.network.replayAudioOnChangeDescription': 'オンにすると、MV を手動で選択または紐付けた後、現在の曲を再生し直して新しい MV をすぐ反映します。',
  'mvSettings.network.restartAudioOnLoad': 'MV を音楽の進行に追従',
  'mvSettings.network.restartAudioOnLoadDescription': 'オンにすると MV の映像時間を継続的に補正し、音声のシークや再起動は行いません。歌詞同期オフセットの影響も受けません。',
  'mvSettings.network.syncMode': '同期モード',
  'mvSettings.network.syncModeDescription': '小さなズレは再生速度で追従し、大きなズレだけ映像をシークします。',
  'mvSettings.network.syncMode.stable': '安定',
  'mvSettings.network.syncMode.balanced': 'バランス',
  'mvSettings.network.syncMode.precise': '高精度',
  'mvSettings.network.title': 'ネットワークソース',
  'mvSettings.offset.aria': 'MV 同期遅延',
  'mvSettings.offset.description': '正の値で MV 映像を早め、負の値で遅らせます。現在の曲の MV だけに保存されます。',
  'mvSettings.offset.earlier': 'MV を {value} 早める',
  'mvSettings.offset.earlierShort': '早める {value}',
  'mvSettings.offset.input': 'オフセット秒数',
  'mvSettings.offset.later': 'MV を {value} 遅らせる',
  'mvSettings.offset.laterShort': '遅らせる {value}',
  'mvSettings.offset.replay': '再生',
  'mvSettings.offset.replayTitle': '現在の曲を再生し直し、MV 開始位置に同期します',
  'mvSettings.offset.reset': 'MV 遅延をリセット',
  'mvSettings.offset.resetShort': 'リセット',
  'mvSettings.offset.slider': 'MV 同期遅延スライダー',
  'mvSettings.offset.startDescription': '動画内の開始秒数を入力します。最大 600 秒まで、この曲はその位置から同期再生されます。',
  'mvSettings.offset.startInput': 'MV 開始秒数',
  'mvSettings.offset.startTitle': '何秒目から再生',
  'mvSettings.offset.step': '調整ステップ',
  'mvSettings.offset.title': 'MV 音ズレ補正',
  'mvSettings.provider.local': 'ローカル',
  'mvSettings.quality.max': '最大',
  'mvSettings.search.input': 'MV 検索キーワード',
  'mvSettings.search.placeholder': 'MV 検索キーワードを入力',
  'mvSettings.search.useCurrentSong': '現在の曲名とアーティストで検索',
  'mvSettings.status.auto': '自動',
  'mvSettings.status.noActiveTrack': '再生中の曲なし',
  'mvSettings.status.none': 'なし',
  'mvSettings.status.off': 'オフ',
  'mvSettings.status.on': 'オン',
  'mvSettings.title': 'MV 設定',
  'trackMenu.action.addToPlaylist': 'プレイリストに追加...',
  'trackMenu.action.playNext': '次に再生',
  'trackMenu.action.addToQueue': 'キューに追加',
  'trackMenu.action.like': 'お気に入り',
  'trackMenu.action.unlike': 'お気に入りを解除',
  'trackMenu.action.removeFromQueue': '再生キューから削除',
  'trackMenu.action.removeFromPlaylist': 'このプレイリストから削除',
  'trackMenu.action.openOsuTiming': 'osu! Timing',
  'trackMenu.action.editTags': 'タグを編集',
  'trackMenu.action.reloadEmbeddedTags': '埋め込みタグを再読み込み',
  'trackMenu.action.clearLyricsCache': '歌詞キャッシュを消去',
  'trackMenu.action.goToAlbum': 'アルバムへ移動',
  'trackMenu.action.showInFolder': 'フォルダで表示',
  'trackMenu.action.copyPath': 'ファイルパスをコピー',
  'trackMenu.action.openSystem': 'システム既定のアプリで開く',
  'trackMenu.action.copyNameArtist': '曲名とアーティストをコピー',
  'trackMenu.action.copyCover': '曲カード画像をコピー',
  'trackMenu.action.saveCover': '曲カード画像を保存',
  'trackMenu.action.deleteSong': '曲を削除',
  'route.playlists.description': 'ユーザープレイリスト。',
  'route.playlists.label': 'プレイリスト',
  'playlistsPage.action.importFile': 'M3U/M3U8 プレイリストを取り込む',
  'playlistsPage.action.newLocal': 'ローカルプレイリストを新規作成',
  'playlistsPage.daily.subtitle': 'NetEase Cloud Music のおすすめ',
  'playlistsPage.daily.title': 'デイリーおすすめ',
  'playlistsPage.empty.create': 'プレイリストを作成',
  'playlistsPage.empty.createFirst': '最初のローカルプレイリストを作成',
  'playlistsPage.empty.local': 'ローカルプレイリストはまだありません。',
  'playlistsPage.error.desktopBridgeDailyRecommend': 'Desktop bridge unavailable. Open ECHO Next in Electron to refresh NetEase daily recommendations.',
  'playlistsPage.form.cancel': '作成をキャンセル',
  'playlistsPage.form.create': '作成',
  'playlistsPage.form.nameAria': 'ローカルプレイリスト名',
  'playlistsPage.form.placeholder': '新しいローカルプレイリスト',
  'playlistsPage.importStreaming.add': 'プレイリストを追加',
  'playlistsPage.importStreaming.adding': '追加中',
  'playlistsPage.importStreaming.placeholder': 'NetEase / QQ Music / KuGou / Spotify のプレイリストリンクを貼り付け',
  'playlistsPage.importStreaming.title': 'ストリーミングプレイリストを追加',
  'playlistsPage.prompt.newLocalName': 'ローカルプレイリスト名',
  'playlistsPage.status.createdLocal': 'ローカルプレイリストを作成しました',
  'playlistsPage.status.importedStreamingPlaylist': 'プレイリストを追加しました: {name}、{count} 曲',
  'playlistsPage.status.importingStreamingPlaylist': 'ストリーミングプレイリストを追加しています...',
  'playlistsPage.status.loading': 'プレイリストを読み込んでいます...',
  'playlistsPage.status.refreshedDaily': 'デイリーおすすめを更新しました: {count} 曲',
  'playlistsPage.status.refreshingDaily': 'NetEase のデイリーおすすめを更新しています...',
  'playlistsPage.view.aria': 'プレイリスト表示',
  'playlistsPage.view.local': 'ローカルプレイリスト',
  'playlistsPage.view.streamingFavorites': 'ストリーミングお気に入り',
  'route.plugins.description': 'ローカルで編集できるプラグイン。',
  'route.plugins.label': 'プラグイン',
  'route.queue.description': '再生キュー。',
  'route.queue.label': 'キュー',
  'queue.action.clear': 'キューを空にする',
  'queue.action.dragLabel': '{title} をドラッグ',
  'queue.action.dragTitle': 'ドラッグして並べ替え',
  'queue.action.generateFromHistory': '履歴からキューを作成',
  'queue.action.generateRandom': 'ランダムキューを作成',
  'queue.action.generatingHistory': '作成中',
  'queue.action.generatingRandom': '作成中',
  'queue.action.autoFill': 'キューを自動補充',
  'queue.action.like': 'お気に入り',
  'queue.action.more': 'その他',
  'queue.action.openFolder': '保存フォルダを開く',
  'queue.action.play': '{title} を今すぐ再生',
  'queue.action.playNext': '{title} を次に再生',
  'queue.action.remove': '{title} を削除',
  'queue.action.shuffle': 'シャッフル',
  'queue.count': '{count} 曲',
  'queue.empty.description': '曲を再生、キューに追加、または次に再生を選ぶとここに表示されます。',
  'queue.empty.title': '次に再生する曲はありません',
  'queue.error.desktopBridge': 'デスクトップブリッジが利用できません。ECHO Next デスクトップ版でライブラリを読み込んでください。',
  'queue.error.noHistoryTracks': 'キュー作成に使える再生履歴がまだありません。',
  'queue.error.noRandomTracks': 'ランダムキューに追加できる曲がライブラリにありません。',
  'queue.header.kicker': '再生キュー',
  'queue.header.title': 'キュー',
  'queue.historySource': 'よく聴く履歴',
  'queue.now.actions': '現在の曲の操作',
  'queue.now.emptyDescription': '曲またはアルバムを再生すると、現在の曲がここに表示されます。',
  'queue.now.emptyTitle': '再生中の曲はありません',
  'queue.now.kicker': '再生中',
  'queue.now.quality': '音質',
  'queue.now.sourceFallback': 'キュー',
  'queue.now.waitingAudio': '音声情報を待機中',
  'queue.quality.unknown': '不明',
  'queue.randomSource': 'ランダムキュー',
  'queue.repeat.all': 'キュー',
  'queue.repeat.mode': 'リピートモード',
  'queue.repeat.off': 'オフ',
  'queue.repeat.one': '1曲',
  'queue.tools': 'キュー操作',
  'queue.upNext.kicker': '次に再生',
  'queue.upNext.title': '次の曲',
  'queue.upNext.waitingCount': '{count} 曲待機中',
  'queue.unknownAlbum': '不明なアルバム',
  'queue.unknownArtist': '不明なアーティスト',
  'route.remote.description': 'リモートソース。',
  'route.remote.label': 'クラウド / リモート',
  'route.settings.description': 'アプリ設定。',
  'route.settings.label': '設定',
  'route.songs.description': 'ローカルライブラリの曲一覧。',
  'route.songs.label': '曲',
  'songs.action.clearList': 'リストをクリア',
  'songs.action.openRecovery': '復旧アシスタントへ',
  'songs.duplicatesOnly': '重複曲のみ表示',
  'songs.error.albumNotFound': 'アルバムが見つかりません: {album}',
  'songs.error.artistNotFound': 'アーティストが見つかりません: {artist}',
  'songs.error.desktopBridgeClear': 'Desktop bridge unavailable. Open ECHO Next in Electron to clear the library list.',
  'songs.error.desktopBridgeFileActions': 'Desktop bridge unavailable. Open ECHO Next in Electron to use file actions.',
  'songs.error.desktopBridgeLyricsCache': 'Desktop bridge unavailable. Open ECHO Next in Electron to clear lyrics cache.',
  'songs.error.desktopBridgeMaintain': 'Desktop bridge unavailable. Open ECHO Next in Electron to maintain the library.',
  'songs.error.desktopBridgePlay': 'Desktop bridge unavailable. Open ECHO Next in Electron to play local files.',
  'songs.error.desktopBridgePlaylists': 'Desktop bridge unavailable. Open ECHO Next in Electron to use playlists.',
  'songs.error.desktopBridgeRead': 'Desktop bridge unavailable. Open ECHO Next in Electron to read the library.',
  'songs.error.desktopBridgeVersions': 'Desktop bridge unavailable. Open ECHO Next in Electron to inspect duplicate versions.',
  'songs.importHint': '音楽ファイルやフォルダーをそのままウィンドウにドラッグできます。MP3、FLAC、WAV、ALAC、AAC、OPUS、OGG、APE、WV、DSF、DFF、CUE などに対応し、その他の形式も自動認識されます。',
  'songs.queueSource.local': '曲リスト',
  'songs.queueSource.remote': 'クラウド曲',
  'songs.search.placeholder': '曲 / アーティスト / アルバムを検索...',
  'songs.sort.album': 'アルバム順',
  'songs.sort.artist': 'アーティスト順',
  'songs.sort.artistAlbum': 'アーティスト / アルバム順',
  'songs.sort.createdAsc': '作成日時（昇順）',
  'songs.sort.createdDesc': '作成日時（降順）',
  'songs.sort.default': 'デフォルト順',
  'songs.sort.durationAsc': '再生時間（短い順）',
  'songs.sort.durationDesc': '再生時間（長い順）',
  'songs.sort.fileModifiedAsc': '更新日時（古い順）',
  'songs.sort.fileModifiedDesc': '更新日時（新しい順）',
  'songs.sort.frequent': 'よく聴く順',
  'songs.sort.menuAria': '曲の並び替え',
  'songs.sort.qualityAsc': '音質/サイズ（小さい順）',
  'songs.sort.qualityDesc': '音質/サイズ（大きい順）',
  'songs.sort.random': 'ランダム順',
  'songs.sort.recent': '最近更新',
  'songs.sort.titleAsc': '曲名（A-Z）',
  'songs.sort.titleDesc': '曲名（Z-A）',
  'songs.trackList.aria': '曲一覧',
  'songs.trackList.empty': '表示できる曲がありません。音楽フォルダーを取り込むと、ここにライブラリ一覧が表示されます。',
  'route.streaming.description': 'ストリーミング音楽ソース。',
  'route.streaming.label': 'ストリーミング',
  'streaming.empty.notFoundAlbum': '一致するアルバムが見つかりません。',
  'streaming.empty.notFoundArtist': '一致するアーティストが見つかりません。',
  'streaming.empty.notFoundPlaylist': '一致するプレイリストが見つかりません。',
  'streaming.empty.notFoundTrack': '一致するストリーミング楽曲が見つかりません。',
  'streaming.empty.searchHint': 'キーワードを入力して検索を開始します。実際の音声 URL は再生時にだけ解決され、キューには保存されません。',
  'streaming.hero.currentProvider': '現在のソース',
  'streaming.hero.description': 'オンラインカタログを検索し、再生前に一時的に音声 URL を解決します。',
  'streaming.hero.meterAria': '現在のストリーミング状態',
  'streaming.hero.preparingSearch': '検索待機中',
  'streaming.hero.title': 'ストリーミング音楽',
  'streaming.provider.available': '利用可能',
  'streaming.provider.disabled': '無効',
  'streaming.provider.loggedIn': '{name} でログイン済み',
  'streaming.provider.notLoggedIn': '未ログイン',
  'streaming.providers.aria': 'ストリーミングプラットフォーム',
  'streaming.quality.high': '高音質',
  'streaming.quality.highDescription': '320kbps を優先',
  'streaming.quality.hires': 'Hi-Res',
  'streaming.quality.hiresDescription': 'プラットフォームで使える時に有効',
  'streaming.quality.label': '音質',
  'streaming.quality.lossless': 'ロスレス',
  'streaming.quality.losslessDescription': 'FLAC を優先',
  'streaming.quality.max': 'Max',
  'streaming.quality.maxDescription': '既定の最高音質',
  'streaming.quality.menuAria': '音質',
  'streaming.quality.standard': '標準',
  'streaming.quality.standardDescription': '互換性を優先',
  'streaming.quality.switchFailed': '音質の切り替えに失敗しました',
  'streaming.quality.switched': '音質を切り替えました: {quality}',
  'streaming.result.count': '{count} 件の結果',
  'streaming.result.searching': '検索中',
  'streaming.result.searchingEllipsis': '検索中...',
  'streaming.search.placeholder': '曲、アーティスト、アルバムを検索',
  'streaming.tab.album': 'アルバム',
  'streaming.tab.artist': 'アーティスト',
  'streaming.tab.playlist': 'プレイリスト',
  'streaming.tab.track': '曲',
  'streaming.tabs.aria': '結果タイプ',
  'settings.header.searchPlaceholder': '設定を検索...',
  'settings.nav.general.label': '一般',
  'settings.nav.general.description': '言語、ウィンドウ、基本動作',
  'settings.nav.playback.label': '再生',
  'settings.nav.playback.description': '出力、バッファ、再生操作',
  'settings.nav.integrations.label': '連携',
  'settings.nav.integrations.description': 'アカウント、Discord、外部デバイス',
  'settings.nav.remote.label': 'クラウド / リモート',
  'settings.nav.remote.description': 'NAS、WebDAV、Subsonic',
  'settings.nav.eq.label': 'EQ',
  'settings.nav.eq.description': 'イコライザーと出力保護',
  'settings.eq.action.addFilter': 'フィルターを追加',
  'settings.eq.action.autoPreamp': '自動 {value}',
  'settings.eq.action.bypass': 'バイパス',
  'settings.eq.action.delete': '削除',
  'settings.eq.action.deleteFilter': 'フィルターを削除',
  'settings.eq.action.holdBypass': '押している間 EQ をバイパス',
  'settings.eq.action.holdOriginal': '押して原音を聴く',
  'settings.eq.action.resetBand': '{frequency} をリセット',
  'settings.eq.action.resetChannelBalance': 'チャンネルバランスをリセット',
  'settings.eq.action.resetDelaysOnly': '遅延をリセット',
  'settings.eq.action.resetEq': 'EQ をリセット',
  'settings.eq.action.save': '保存',
  'settings.eq.band.fallback': 'バンド',
  'settings.eq.band.readoutsAria': '31 バンド EQ のドラッグ可能なバンド表示',
  'settings.eq.bitPerfect.channelDisabled': 'DSP 有効: bit-perfect は無効です。',
  'settings.eq.bitPerfect.disabled': 'DSP 有効: bit-perfect は無効です{reason}。',
  'settings.eq.bitPerfect.readyPath': 'bit-perfect 経路を維持できます。',
  'settings.eq.bitPerfect.sourceBoth': 'EQ + チャンネルバランス',
  'settings.eq.bitPerfect.sourceChannel': 'チャンネルバランス',
  'settings.eq.bitPerfect.sourceEq': 'EQ',
  'settings.eq.bitPerfect.sourceRoom': 'ルーム補正',
  'settings.eq.channel.active': '有効',
  'settings.eq.channel.balance': 'バランス',
  'settings.eq.channel.bypassed': 'バイパス',
  'settings.eq.channel.center': '中央',
  'settings.eq.channel.constantPower': '定電力',
  'settings.eq.channel.description': 'Balance は左右定位、L/R Gain は音量、L/R Delay は到達時間を補正します。Mono Sum と Invert は確認用です。',
  'settings.eq.channel.dsp': 'DSP',
  'settings.eq.channel.group.timing': 'Timing',
  'settings.eq.channel.invertLeft': '左を反転',
  'settings.eq.channel.invertRight': '右を反転',
  'settings.eq.channel.leftDelay': '左遅延',
  'settings.eq.channel.leftGain': '左ゲイン',
  'settings.eq.channel.leftTotal': '左合計',
  'settings.eq.channel.mono.left': '左',
  'settings.eq.channel.mono.off': 'オフ',
  'settings.eq.channel.mono.right': '右',
  'settings.eq.channel.mono.sum': '合成',
  'settings.eq.channel.monoMode': 'モノモード',
  'settings.eq.channel.rightDelay': '右遅延',
  'settings.eq.channel.rightGain': '右ゲイン',
  'settings.eq.channel.rightTotal': '右合計',
  'settings.eq.channel.swap': 'L/R 交換',
  'settings.eq.channel.title': 'チャンネルバランス',
  'settings.eq.channel.wizard.apply': '測定補正を適用',
  'settings.eq.channel.wizard.clear': '測定をクリア',
  'settings.eq.channel.wizard.empty': '測定待ち',
  'settings.eq.channel.wizard.imageLeft': '定位が左寄り',
  'settings.eq.channel.wizard.imageRight': '定位が右寄り',
  'settings.eq.channel.wizard.leftDistance': '左距離',
  'settings.eq.channel.wizard.leftLouder': '左が大きい',
  'settings.eq.channel.wizard.leftSpl': '左 SPL',
  'settings.eq.channel.wizard.monitor': '空間補正モニター',
  'settings.eq.channel.wizard.nudge': '空間補正の微調整',
  'settings.eq.channel.wizard.previewCenter': '中央確認',
  'settings.eq.channel.wizard.previewLeft': '左確認',
  'settings.eq.channel.wizard.previewRight': '右確認',
  'settings.eq.channel.wizard.ready': '適用可',
  'settings.eq.channel.wizard.rightDistance': '右距離',
  'settings.eq.channel.wizard.rightLouder': '右が大きい',
  'settings.eq.channel.wizard.rightSpl': '右 SPL',
  'settings.eq.channel.wizard.title': '空間補正ウィザード',
  'settings.eq.curve.aria': 'ドラッグ可能な 31 バンド EQ 周波数特性',
  'settings.eq.curve.dragBand': '{frequency} EQ バンドをドラッグ',
  'settings.eq.filter.highShelf': 'ハイシェルフ',
  'settings.eq.filter.highPass': 'ハイパス',
  'settings.eq.filter.lowShelf': 'ローシェルフ',
  'settings.eq.filter.lowPass': 'ローパス',
  'settings.eq.filter.notch': 'ノッチ',
  'settings.eq.filter.peaking': 'ピーキング',
  'settings.eq.headphoneCorrection.ab': 'ヘッドホン補正 A/B',
  'settings.eq.headphoneCorrection.compareCorrected': '補正後',
  'settings.eq.headphoneCorrection.compareOriginal': '原音と比較',
  'settings.eq.headphoneCorrection.convert': 'カスタム EQ に変換',
  'settings.eq.headphoneCorrection.customName': 'カスタム EQ - {name}',
  'settings.eq.headphoneCorrection.lockAria': 'ヘッドホン補正 EQ ロック',
  'settings.eq.headphoneCorrection.lockDetail': '{name} はヘッドホン補正で管理されています。手動調整するには、先にカスタム EQ に変換してください。',
  'settings.eq.headphoneCorrection.lockedError': 'この OPRA preset はヘッドホン補正で管理されています。先に「カスタム EQ に変換」を押してから調整してください。',
  'settings.eq.headphoneCorrection.managed': 'ヘッドホン補正が管理中',
  'settings.eq.error.bridgeChannelBalance': 'デスクトップブリッジを利用できません。ECHO Next デスクトップ版でチャンネルバランスを操作してください。',
  'settings.eq.error.bridgeControlEq': 'デスクトップブリッジを利用できません。ECHO Next デスクトップ版で EQ を操作してください。',
  'settings.eq.error.bridgeDeletePreset': 'デスクトップブリッジを利用できません。ECHO Next デスクトップ版で EQ プリセットを削除してください。',
  'settings.eq.error.bridgeSavePreset': 'デスクトップブリッジを利用できません。ECHO Next デスクトップ版で EQ プリセットを保存してください。',
  'settings.eq.error.presetName': 'プリセット名を入力してください。',
  'settings.eq.export.successApo': 'Equalizer APO 設定を書き出しました: {path}',
  'settings.eq.export.successGraphicEq': 'GraphicEQ 設定を書き出しました: {path}',
  'settings.eq.export.successPreset': 'EQ プリセットを書き出しました: {path}',
  'settings.eq.import.filters': 'Filter',
  'settings.eq.import.filtersValue': '{count} インポート / {skipped} スキップ',
  'settings.eq.import.filterPreview': 'Filter 詳細',
  'settings.eq.import.filterEnabledAria': 'インポート Filter {index} の有効状態',
  'settings.eq.import.filterFrequencyAria': 'インポート Filter {index} の周波数',
  'settings.eq.import.filterGainAria': 'インポート Filter {index} のゲイン',
  'settings.eq.import.filterQAria': 'インポート Filter {index} の Q',
  'settings.eq.import.filterTypeAria': 'インポート Filter {index} のタイプ',
  'settings.eq.import.estimatedPeak': '推定ピーク',
  'settings.eq.import.graphicEq': 'GraphicEQ 点',
  'settings.eq.import.includes': 'Include ファイル',
  'settings.eq.import.includesValue': '{count} 展開 / {skipped} スキップ',
  'settings.eq.import.maxBoost': '最大ブースト',
  'settings.eq.import.maxCut': '最大カット',
  'settings.eq.import.apoDirectives': 'APO 指令',
  'settings.eq.import.apoDirectiveDetails': '指令詳細',
  'settings.eq.import.apoDirectivesValue': '{count} 認識 / {skipped} チャンネル Filter スキップ',
  'settings.eq.import.bandwidthFilters': 'BW 変換',
  'settings.eq.import.bandwidthFiltersValue': '{count} 件を Q に変換',
  'settings.eq.import.compatibility': '互換性',
  'settings.eq.import.compatibility.adjusted': '変換済み',
  'settings.eq.import.compatibility.clean': '完全インポート',
  'settings.eq.import.compatibility.partial': '部分インポート',
  'settings.eq.import.moreFilters': 'ほか {count} 件の Filter は未表示',
  'settings.eq.import.noFilters': '表示する有効なフィルターはありません。',
  'settings.eq.import.preamp': 'Preamp',
  'settings.eq.import.preampAria': 'インポートプリセット Preamp',
  'settings.eq.import.safePreamp': '推奨ヘッドルーム',
  'settings.eq.import.safetyDetail': '現在の Filter から概算します。適用前に安全な余裕を確保できます。',
  'settings.eq.import.safetyNeedsHeadroom': 'ヘッドルームが必要',
  'settings.eq.import.safetyOk': '余裕は安全そうです',
  'settings.eq.import.safetyTitle': 'インポート安全性',
  'settings.eq.import.audition': 'インポートを試聴',
  'settings.eq.import.auditionPresetName': '試聴 {name}',
  'settings.eq.import.restoreAudition': '元の設定に戻す',
  'settings.eq.import.clearPaste': 'クリア',
  'settings.eq.import.applyPreview': 'インポートを適用',
  'settings.eq.import.cancelPreview': 'キャンセル',
  'settings.eq.import.pasteDefaultName': '貼り付けた APO',
  'settings.eq.import.pasteEmpty': 'Equalizer APO 設定を貼り付けてください。',
  'settings.eq.import.pasteFileName': '貼り付け内容',
  'settings.eq.import.pasteIncludeWarning': '貼り付けインポートでは Include ファイルを読み込みません。Include を展開するにはファイルインポートを使ってください。',
  'settings.eq.import.pasteTitle': 'APO テキスト',
  'settings.eq.import.previewPaste': 'APO をプレビュー',
  'settings.eq.import.previewTitle': 'インポートプレビュー',
  'settings.eq.import.reportTitle': 'インポート完了',
  'settings.eq.import.source': 'ソース',
  'settings.eq.import.sourceApo': 'Equalizer APO',
  'settings.eq.import.sourceEcho': 'ECHO JSON',
  'settings.eq.import.updateAudition': '試聴を更新',
  'settings.eq.import.useSafePreamp': '推奨値を使用',
  'settings.eq.action.hideAdvanced': 'PEQ コンソールを隠す',
  'settings.eq.action.importPreset': 'プリセット / APO をインポート',
  'settings.eq.action.pasteApoPreset': 'APO を貼り付け',
  'settings.eq.action.exportApoGraphicEqPreset': 'GraphicEQ へ書き出し',
  'settings.eq.action.exportApoPreset': 'APO へ書き出し',
  'settings.eq.action.showAdvanced': 'PEQ コンソール',
  'settings.eq.ab.summary': '{preset} / peak {peak} / out {output} / preamp {preamp}',
  'settings.eq.autoGain.adjustment': 'Auto {value}',
  'settings.eq.autoGain.status': '状態',
  'settings.eq.autoGain.status.clipping': 'Clipping',
  'settings.eq.autoGain.status.holding': 'Holding',
  'settings.eq.autoGain.status.idle': 'Idle',
  'settings.eq.autoGain.status.recovering': 'Recovering',
  'settings.eq.autoGain.status.reducing': 'Reducing',
  'settings.eq.autoGain.toggle': 'Auto Gain',
  'settings.eq.room.active': 'Active',
  'settings.eq.room.channelMode': 'チャンネル',
  'settings.eq.room.clear': 'クリア',
  'settings.eq.room.disable': 'FIR 無効',
  'settings.eq.room.empty': '未読込',
  'settings.eq.room.enable': 'FIR 有効',
  'settings.eq.room.error': 'エラー',
  'settings.eq.room.error.invalidImpulse': 'IR 無効',
  'settings.eq.room.error.invalidWav': 'WAV 無効',
  'settings.eq.room.error.missingFile': 'IR ファイルなし',
  'settings.eq.room.error.missingIr': 'IR 未読込',
  'settings.eq.room.error.tooLong': 'IR が長すぎます',
  'settings.eq.room.import': 'IR 読込',
  'settings.eq.room.ir': 'IR',
  'settings.eq.room.loaded': 'Loaded',
  'settings.eq.room.sampleRate': 'サンプル',
  'settings.eq.room.short': 'FIR',
  'settings.eq.room.tapCount': 'Taps',
  'settings.eq.room.title': 'ルーム補正',
  'settings.eq.room.trim': 'Trim',
  'settings.eq.analyzer.overlayAria': 'EQ リアルタイムスペクトラム表示',
  'settings.eq.analyzer.input': 'Input',
  'settings.eq.analyzer.mode': 'スペクトラムモード',
  'settings.eq.analyzer.postEq': 'Post EQ',
  'settings.eq.analyzer.status': '状態',
  'settings.eq.analyzer.status.live': 'Live',
  'settings.eq.analyzer.status.noSignal': 'No signal',
  'settings.eq.analyzer.status.off': 'Off',
  'settings.eq.analyzer.status.priming': 'Priming',
  'settings.eq.analyzer.toggle': 'スペクトラム',
  'settings.eq.band.console': '選択バンドコンソール',
  'settings.eq.band.enabledShort': '有効',
  'settings.eq.band.filters': 'フィルター',
  'settings.eq.band.filterStack': 'APO フィルターチェーン',
  'settings.eq.band.gainFixed': 'このタイプではゲイン固定',
  'settings.eq.band.qPresets': 'Q クイック値',
  'settings.eq.band.qPresetWide': 'Wide',
  'settings.eq.band.qPresetNormal': 'Normal',
  'settings.eq.band.qPresetNarrow': 'Narrow',
  'settings.eq.band.matrix': 'PEQ バンドマトリクス',
  'settings.eq.band.modeFree': '自由周波数',
  'settings.eq.band.modeStandard': '標準バンド',
  'settings.eq.comfort.direct': '原音ダイレクト',
  'settings.eq.comfort.directDetail': 'DSP オフ時は音量を下げず、サンプルも変更しません。原音を安心して聴けます。',
  'settings.eq.comfort.risk': 'レベルに注意',
  'settings.eq.comfort.riskDetail': 'クリップの可能性または保護動作を検出しました。まず -6 dB ヘッドルームを確保してください。',
  'settings.eq.comfort.tuned': '音を調整中',
  'settings.eq.comfort.tunedDetail': '有効な DSP モジュールだけを処理します。オフにするとネイティブ再生経路へ戻ります。',
  'settings.eq.level.clips': 'クリップ {count}',
  'settings.eq.level.estimatedOutputPeak': '推定出力ピーク',
  'settings.eq.level.headroom': 'ヘッドルーム',
  'settings.eq.level.inputPeak': '入力ピーク',
  'settings.eq.level.inputRms': '入力 RMS',
  'settings.eq.level.sourceEstimate': 'pre-native + DSP 推定',
  'settings.eq.preamp.aria': 'EQ プリアンプ',
  'settings.eq.preamp.inputSafety': 'ヘッドルーム管理',
  'settings.eq.preamp.safeHeadroom': '安全ヘッドルーム',
  'settings.eq.preset.nameAria': 'プリセット名',
  'settings.eq.preset.readonly': '内蔵プリセットは読み取り専用です。',
  'settings.eq.preset.savePlaceholder': 'ユーザープリセットとして保存',
  'settings.eq.state.eqDisabled': 'EQ 無効',
  'settings.eq.state.eqEnabled': 'EQ 有効',
  'settings.eq.status.bitPerfect': 'Bit-perfect',
  'settings.eq.status.clippingRisk': 'クリップ危険',
  'settings.eq.status.eq': 'EQ',
  'settings.eq.status.headroom': 'ヘッドルーム',
  'settings.eq.status.preamp': 'プリアンプ',
  'settings.eq.status.preset': 'プリセット',
  'settings.eq.status.processor': 'プロセッサ',
  'settings.eq.status.realtimeIir': 'リアルタイム IIR',
  'settings.eq.status.safe': '安全',
  'settings.eq.status.safeHeadroomShort': '安全ヘッドルーム',
  'settings.eq.status.warning': '警告',
  'settings.eq.signal.armed': '待機',
  'settings.eq.signal.bitPerfectOutput': 'Bit-perfect 経路',
  'settings.eq.signal.dspActive': 'DSP 信号チェーン有効',
  'settings.eq.signal.dspOutput': 'DSP 出力',
  'settings.eq.signal.input': '入力',
  'settings.eq.signal.limiter': '保護',
  'settings.eq.signal.output': '出力',
  'settings.eq.signal.peq': 'PEQ',
  'settings.eq.signal.preamp': 'プリアンプ',
  'settings.eq.signal.protecting': '保護中',
  'settings.eq.signal.title': '信号チェーン',
  'settings.eq.simpleAction.customPresetName': 'My EQ Tone',
  'settings.eq.simpleAction.lastTweak': '直前の調整',
  'settings.eq.simpleAction.nextVibe': '次の音',
  'settings.eq.simpleAction.nextVibeDetail': '試してみる',
  'settings.eq.simpleAction.savedPresetName': '{name} {amount}%',
  'settings.eq.simpleAction.saveVibe': '音作りを保存',
  'settings.eq.simpleAction.saveVibeDetail': '現在を保存',
  'settings.eq.simpleInsight.amount': '強さ',
  'settings.eq.simpleInsight.aria': 'Simple 現在の音作り概要',
  'settings.eq.simpleInsight.custom': '手動音作り',
  'settings.eq.simpleInsight.mainChange': '主な変化',
  'settings.eq.simpleInsight.ready': '準備完了',
  'settings.eq.simpleInsight.vibe': '現在の音',
  'settings.eq.simpleSafety.action': '余裕を確保',
  'settings.eq.simpleSafety.aria': 'Simple 安全ヘッドルーム',
  'settings.eq.simpleSafety.risk': '余裕が必要',
  'settings.eq.simpleSafety.riskDetail': 'ピーク {peak} / 推奨 {preamp}',
  'settings.eq.simpleSafety.safe': '余裕あり',
  'settings.eq.simpleSafety.safeDetail': 'ピーク {peak} / プリアンプ {preamp}',
  'settings.eq.simpleTone.air': '空気感',
  'settings.eq.simpleTone.airDetail': '明るく広がる',
  'settings.eq.simpleTone.amount': '味の強さ',
  'settings.eq.simpleTone.amountAria': 'Simple 音作りの強さ',
  'settings.eq.simpleTone.aria': 'Simple 音作りクイック調整',
  'settings.eq.simpleTone.bass': '低音弾力',
  'settings.eq.simpleTone.bassDetail': 'キックを豊かに',
  'settings.eq.simpleTone.flat': 'フラット',
  'settings.eq.simpleTone.flatDetail': '元に戻す',
  'settings.eq.simpleTone.less': '弱める',
  'settings.eq.simpleTone.more': '強める',
  'settings.eq.simpleTone.vocal': 'ボーカル前へ',
  'settings.eq.simpleTone.vocalDetail': '歌詞を明瞭に',
  'settings.eq.simpleTone.warm': '少し暖かく',
  'settings.eq.simpleTone.warmDetail': '柔らかく聴く',
  'settings.eq.simpleZone.air': '空気感',
  'settings.eq.simpleZone.airDetail': '明るさと広がり',
  'settings.eq.simpleZone.applyAria': '{zone} の音作りを適用、現在 {value}',
  'settings.eq.simpleZone.aria': 'Simple 音域変化',
  'settings.eq.simpleZone.low': '低域',
  'settings.eq.simpleZone.lowDetail': 'キックと厚み',
  'settings.eq.simpleZone.neutral': 'フラット',
  'settings.eq.simpleZone.vocal': 'ボーカル',
  'settings.eq.simpleZone.vocalDetail': '歌詞と存在感',
  'settings.eq.routing.action.armHeadroom6': '-6dB ヘッドルームを待機',
  'settings.eq.routing.action.nativeDirect': 'ネイティブ直通',
  'settings.eq.routing.armed': '待機中',
  'settings.eq.routing.dspPath': 'DSP パス',
  'settings.eq.routing.dspPathDetail': '有効な処理は信号経路に明示されます。',
  'settings.eq.routing.headroomActiveDetail': 'ヘッドルームは DSP パスで有効です。',
  'settings.eq.routing.headroomStandby': 'ヘッドルーム待機',
  'settings.eq.routing.headroomStandbyDetail': 'DSP を有効にした時だけ適用されます。',
  'settings.eq.routing.modules': 'モジュール',
  'settings.eq.routing.modulesActiveDetail': '有効な処理段は下に表示されます。',
  'settings.eq.routing.modulesBypassed': 'バイパス済み',
  'settings.eq.routing.modulesBypassedDetail': 'EQ / FIR / Balance はオフです。',
  'settings.eq.routing.nativeBypassComfort': 'DSP バイパス時はネイティブ直通を保ち、サンプルはエフェクトチェーンで変更されません。',
  'settings.eq.routing.nativeDirect': 'ネイティブ直通',
  'settings.eq.routing.nativeDirectDetail': 'DSP バイパス時はネイティブ再生を変更しません。',
  'settings.eq.routing.nativeNoGainDetail': 'ネイティブ直通ではゲインを下げません。',
  'settings.eq.routing.playbackPath': '再生パス',
  'settings.eq.routing.protectActive': '保護中',
  'settings.eq.routing.protectActiveDetail': 'Limiter が過負荷を防いでいます。',
  'settings.eq.routing.safety': '安全',
  'settings.eq.headroom.dsp': 'DSP ヘッドルーム',
  'settings.eq.headroom.nativeBypassNote': 'EQ / FIR / Balance が有効な時だけ適用され、ネイティブバイパスは直通のままです。',
  'settings.eq.headroom.presetsAria': 'DSP ヘッドルームのプリセット',  'settings.eq.mode.aria': 'EQ 表示モード',
  'settings.eq.mode.current': 'モード',
  'settings.eq.mode.pro': 'Pro',
  'settings.eq.mode.simple': 'Simple',
  'settings.eq.section.channel': 'チャンネルとモニター',
  'settings.eq.section.compare': 'A/B とバイパス比較',
  'settings.eq.subtitle': '音のカーブ、安全ヘッドルーム、詳細調整',
  'settings.eq.title': 'EQ',
  'settings.eq.warning.channelClipping': 'クリップの危険があります。ゲインまたはプリアンプを下げると安全です。',
  'settings.eq.warning.lowerPreamp': 'クリップを避けるにはプリアンプを下げてください。',
  'settings.nav.appearance.label': '外観',
  'settings.nav.appearance.description': 'テーマ、フォント、背景',
  'settings.nav.library.label': 'メディアライブラリ',
  'settings.nav.library.description': '取り込み、スキャン、整理',
  'settings.nav.plugins.label': 'プラグイン',
  'settings.nav.plugins.description': 'ローカル拡張、権限、スクリプト',
  'settings.plugins.card.title': 'ローカルプラグイン',
  'settings.plugins.card.description': 'プラグインは既定で userData/plugins に置かれ、echo.plugin.json、plugin.js、パネルファイルを直接編集できます。',
  'settings.plugins.meta.runtime': '実行方式',
  'settings.plugins.meta.runtimeValue': 'ローカルサンドボックス',
  'settings.plugins.meta.defaultState': '既定状態',
  'settings.plugins.meta.defaultStateValue': '手動で有効化',
  'settings.plugins.meta.permissions': '権限',
  'settings.plugins.meta.permissionsValue': '有効化時に確認',
  'settings.plugins.meta.playbackSafety': '再生安全性',
  'settings.plugins.meta.playbackSafetyValue': '音声ホットパスに入らない',
  'settings.plugins.action.openPage': 'プラグインページを開く',
  'settings.plugins.action.openDirectory': 'プラグインフォルダーを開く',
  'settings.plugins.action.createExample': 'サンプルプラグインを作成',
  'settings.plugins.action.openDocs': 'プラグイン文書を見る',
  'settings.plugins.note': 'プラグインページで有効化、無効化、再読み込み、コマンド、ログを扱います。ここでは入口と安全境界の説明だけを残し、管理 UI が二重化しないようにします。',
  'settings.nav.about.label': '情報 / 詳細',
  'settings.nav.about.description': 'バージョン、更新、開発ツール',
  'settings.nav.danger.label': '危険な操作',
  'settings.nav.danger.description': '復元とネットワーク安全性',
  'settings.general.artistInfoSources.description': 'アーティスト紹介を更新するときに使う百科ソースを選びます。百度百科は中国語圏向け、Wikipedia は海外アーティストの補完に使えます。',
  'settings.nav.shortcuts.label': 'ショートカット',
  'settings.nav.shortcuts.description': '通常ショートカット、グローバルショートカット、再生操作',
  'settings.shortcuts.action.clear': 'クリア',
  'settings.shortcuts.action.bossKey.description': 'ウィンドウを即座に隠し、ECHO の音量を 0 に下げます。',
  'settings.shortcuts.action.bossKey.title': 'ボスキー',
  'settings.shortcuts.action.nextTrack.description': '現在の再生キューの次の曲へ移動します。',
  'settings.shortcuts.action.nextTrack.title': '次の曲',
  'settings.shortcuts.action.openAudioSettings.description': '下部プレイヤーの音声設定ドロワーを開きます。',
  'settings.shortcuts.action.openAudioSettings.title': '音声設定を開く',
  'settings.shortcuts.action.openLyricsSettings.description': '歌詞設定ドロワーを開きます。',
  'settings.shortcuts.action.openLyricsSettings.title': '歌詞設定を開く',
  'settings.shortcuts.action.openMvSettings.description': 'MV 設定ドロワーを開きます。',
  'settings.shortcuts.action.openMvSettings.title': 'MV 設定を開く',
  'settings.shortcuts.action.locateCurrentTrack.description': '現在のリストを再生中の曲の位置までスクロールします。',
  'settings.shortcuts.action.locateCurrentTrack.title': '再生中の曲へ移動',
  'settings.shortcuts.action.playPause.description': 'グローバルで再生と一時停止を切り替えます。',
  'settings.shortcuts.action.playPause.title': '再生 / 一時停止',
  'settings.shortcuts.action.previousTrack.description': '現在の再生キューの前の曲へ移動します。',
  'settings.shortcuts.action.previousTrack.title': '前の曲',
  'settings.shortcuts.action.record': '記録',
  'settings.shortcuts.action.restoreRecommended': 'おすすめを復元',
  'settings.shortcuts.action.seekBackward.description': '現在の曲を 10 秒戻します。',
  'settings.shortcuts.action.seekBackward.title': '10 秒戻る',
  'settings.shortcuts.action.seekForward.description': '現在の曲を 10 秒進めます。',
  'settings.shortcuts.action.seekForward.title': '10 秒進む',
  'settings.shortcuts.action.showMainWindow.description': 'ECHO のメインウィンドウを前面に戻します。',
  'settings.shortcuts.action.showMainWindow.title': 'メインウィンドウを表示',
  'settings.shortcuts.action.speedDown.description': '再生速度を毎回 0.1x 下げます。',
  'settings.shortcuts.action.speedDown.title': '再生速度を下げる',
  'settings.shortcuts.action.speedUp.description': '再生速度を毎回 0.1x 上げます。',
  'settings.shortcuts.action.speedUp.title': '再生速度を上げる',
  'settings.shortcuts.action.stop.description': '現在の再生を停止し、再生状態を解放します。',
  'settings.shortcuts.action.stop.title': '再生停止',
  'settings.shortcuts.action.toggleDesktopLyrics.description': 'デスクトップ歌詞ウィンドウを表示または非表示にします。',
  'settings.shortcuts.action.toggleDesktopLyrics.title': 'デスクトップ歌詞の表示切替',
  'settings.shortcuts.action.toggleDesktopLyricsLock.description': 'デスクトップ歌詞のマウス透過ロックを切り替えます。',
  'settings.shortcuts.action.toggleDesktopLyricsLock.title': '歌詞をロック / 解除',
  'settings.shortcuts.action.volumeDown.description': 'ECHO の音量を 5% 下げます。',
  'settings.shortcuts.action.volumeDown.title': '音量を下げる',
  'settings.shortcuts.action.volumeUp.description': 'ECHO の音量を 5% 上げます。',
  'settings.shortcuts.action.volumeUp.title': '音量を上げる',
  'settings.shortcuts.column.function': '機能',
  'settings.shortcuts.column.local': '通常ショートカット',
  'settings.shortcuts.column.global': 'グローバルショートカット',
  'settings.shortcuts.description': '通常ショートカットは ECHO ウィンドウがフォーカスされている時だけ有効です。グローバルショートカットはバックグラウンドでも動作し、有効化前にシステム競合を確認します。',
  'settings.shortcuts.empty': '未割り当て',
  'settings.shortcuts.localUnavailable': 'グローバルのみ',
  'settings.shortcuts.message.duplicate': 'このショートカットは別の操作にすでに割り当てられています。',
  'settings.shortcuts.message.empty': '先にショートカットを記録してください。',
  'settings.shortcuts.message.invalid': 'このキーは現在ショートカットとして使えません。',
  'settings.shortcuts.message.safe': 'このショートカットは使用できます。',
  'settings.shortcuts.message.unavailable': 'このショートカットはシステムまたは他のアプリで使用中のため、無効のままです。',
  'settings.shortcuts.message.unsafe': 'このキーは現在ショートカットとして使えません。マクロパッド側で標準キーボードキーかメディアキーを出力してください。',
  'settings.shortcuts.note': '単独キー、組み合わせ、メディアキー、マクロパッドキー、マウス側面ボタンに対応します。通常ショートカットは入力欄では発火しません。',
  'settings.shortcuts.recording': '新しいショートカットを押してください...',
  'settings.shortcuts.scope.local': '通常ショートカット',
  'settings.shortcuts.scope.global': 'グローバルショートカット',
  'settings.shortcuts.title': 'ショートカット',
  'settings.general.artistInfoSources.title': 'アーティスト情報ソース',
  'settings.general.artistStreamingAlbums.description': '有効にすると、アーティスト詳細のアルバムページでローカルアルバムの下にストリーミングアルバムを必要に応じて検索して表示します。ページとネットワーク負荷を抑えるため既定ではオフです。',
  'settings.general.artistStreamingAlbums.title': 'ストリーミングアルバム',
  'settings.general.language.title': '表示言語',
  'settings.general.language.description': 'メニュー、アプリ内設定、システムダイアログの表示言語を選択します。',
  'settings.general.dataBackup.title': '自動データバックアップ',
  'settings.general.dataBackup.description': '設定、ライブラリ索引、再生履歴、アカウントのローカル状態、壁紙、カバーキャッシュ、メタデータを保存します。バックアップ前にライブラリデータベースを検証し、破損データは拒否されます。',
  'settings.general.dataBackup.status.enabled': '自動バックアップは有効です',
  'settings.general.dataBackup.status.disabled': '自動バックアップは無効です',
  'settings.general.dataBackup.hint.directoryReady': '保存先が設定済みです。手動バックアップや定期バックアップを開始できます',
  'settings.general.dataBackup.hint.chooseDirectory': '先にバックアップ保存先を選択してください',
  'settings.general.dataBackup.frequency.aria': '自動バックアップ周期',
  'settings.general.dataBackup.frequency.days': '{days} 日',
  'settings.general.dataBackup.frequency.monthly': '毎月',
  'settings.general.dataBackup.meta.directory': '保存先',
  'settings.general.dataBackup.meta.lastBackup': '前回のバックアップ',
  'settings.general.dataBackup.meta.nextRun': '次回実行',
  'settings.general.dataBackup.meta.notSet': '未設定',
  'settings.general.dataBackup.meta.noneYet': '自動バックアップはまだありません',
  'settings.general.dataBackup.meta.nextRunPending': '保存先を選んで有効にすると反映されます',
  'settings.general.dataBackup.meta.atPath': '{time} · {path}',
  'settings.general.dataBackup.progress.preparing': '準備中',
  'settings.general.dataBackup.progress.snapshot': 'スナップショット作成',
  'settings.general.dataBackup.progress.scanning': 'スキャン中',
  'settings.general.dataBackup.progress.writing': '書き込み中',
  'settings.general.dataBackup.progress.finalizing': '完了処理中',
  'settings.general.dataBackup.progress.completed': '完了',
  'settings.general.dataBackup.progress.failed': '失敗',
  'settings.general.dataBackup.progress.measuring': '集計中',
  'settings.general.dataBackup.progress.waiting': '書き込み待機中',
  'settings.general.dataBackup.action.chooseDirectory': '保存先を選択',
  'settings.general.dataBackup.action.choosingDirectory': '選択中...',
  'settings.general.dataBackup.action.backupNow': '今すぐバックアップ',
  'settings.general.dataBackup.action.backingUp': 'バックアップ中...',
  'settings.general.dataBackup.action.importBackup': 'バックアップを読み込む',
  'settings.general.dataBackup.action.importingBackup': '読み込み中...',
  'settings.general.dataBackup.action.openDirectory': 'フォルダーを開く',
  'settings.general.dataPackage.title': 'ECHO データパッケージを書き出し / 移行',
  'settings.general.dataPackage.description': '設定、ライブラリ索引、プレイリストのスナップショット、カバーキャッシュのパス、アカウント状態の説明を書き出します。音楽ファイルやログインキーは含まれません。',
  'settings.general.dataPackage.action.export': 'ECHO データパッケージを書き出す',
  'settings.general.dataPackage.action.exporting': 'パッケージ中...',
  'settings.general.dataPackage.action.recovery': '復元入口',
  'settings.general.dataPackage.note': '復元前に危険な操作エリアで健全スナップショットを作成してください。移行パッケージ内の RESTORE.md に各ファイルの用途が書かれています。',
  'settings.general.closeToTray': '閉じる時にトレイへ隠す',
  'settings.general.sidebarAutoHide.title': 'サイドバーを隠す',
  'settings.general.sidebarAutoHide.description': '有効にするとサイドバーを画面端に収納し、マウスを左端へ移動したときに自動で引き出します。既定ではオフです。',
  'settings.general.fastStartup.description': '有効にすると、起動時は軽量な読み取り専用のライブラリ確認だけを行い、完全なデータ保護スナップショットはウィンドウ表示後にバックグラウンドで完了します。既定ではオフです。',
  'settings.general.fastStartup.title': '高速起動',
  'settings.general.firstRunWizard.description': '有効にすると初回起動時のガイドをもう一度表示し、標準出力（システムオーディオ）、WASAPI、Exclusive、ASIO を選べます。完了またはスキップ後、このスイッチは自動でオフになります。',
  'settings.general.firstRunWizard.title': '初回起動ガイド',
  'settings.general.playerWaveformProgress.description': '有効にすると、下部プレイヤーの進行表示を軽量な波形スタイルにします。既定ではオフで、音声デコードやバックグラウンド解析は行いません。',
  'settings.general.playerWaveformProgress.title': '波形プログレスバー',
  'settings.general.homeWaveformVisualizer.description': 'ホームの「今日のエコー」に表示するリアルタイム波形を制御します。オフにすると波形を描画せず、ホーム波形用のスペクトラム解析もスキップします。',
  'settings.general.homeWaveformVisualizer.title': 'ホーム波形ビジュアライザー',
  'settings.general.homeRandomHeroTitle.description': '有効にすると、ホームの見出しをランダムな文言プールから選び、少しネットネタも混ぜます。オフにすると固定の見出しを使います。',
  'settings.general.homeRandomHeroTitle.title': 'ホームのランダム見出し',
  'settings.general.rememberWindowSize.description': '有効にすると、前回ドラッグして変更したウィンドウの幅と高さを記憶し、次回起動時に自動で復元します。',
  'settings.general.rememberWindowSize.title': 'ウィンドウサイズを記憶',
  'settings.general.searchTraditionalVariants.description': '有効にすると、繁体字入力で簡体字の結果を検索でき、簡体字入力でも繁体字の結果を検索できます。',
  'settings.general.searchTraditionalVariants.title': '簡体字・繁体字の相互検索',
  'settings.general.backup.title': '設定のバックアップ',
  'settings.general.backup.description': '新しいデバイスへの移行や復元のため、ECHO Next の設定をエクスポートまたはインポートします。',
  'settings.general.backup.export': '設定を書き出す',
  'settings.general.backup.import': '設定を読み込む',
  'settings.playback.outputMode.asio': 'ASIO',
  'settings.playback.outputMode.title': '出力モード',
  'settings.playback.advancedPanel.action.collapse': '高度な再生設定を閉じる',
  'settings.playback.advancedPanel.action.expand': '高度な再生設定を開く',
  'settings.playback.advancedPanel.description': '低負荷、診断、JUCE / DSD、書き出し、細かな再生制御は既定で折りたたみ、通常の出力設定を見やすくします。',
  'settings.playback.advancedPanel.memory': '開閉状態を記憶します',
  'settings.playback.advancedPanel.title': '高度な再生設定',
  'settings.playback.asioNativeDsd.description': '既定ではオフです。ASIO + ローカル DSF + DoP が有効で、EQ/音量/変速/DSP がない場合のみ試行します。失敗時は既存の DoP/PCM に戻ります。',
  'settings.playback.asioNativeDsd.title': 'ASIO ネイティブ DSD 実験',
  'settings.playback.dsdDop.description': '既定ではオフです。ローカル DSF を ASIO で DoP 直出しし、失敗時は FFmpeg PCM に自動で戻します。最終確認は DAC 表示を基準にしてください。',
  'settings.playback.dsdDop.requiresAsio': 'ASIO が必要です',
  'settings.playback.dsdDop.title': 'DSD DoP 直出し試験',
  'settings.playback.exportFormat.description': '下部バーの書き出しボタンで使う形式です。書き出し速度は現在の再生速度に従います。',
  'settings.playback.exportFormat.title': '音声書き出し形式',
  'settings.playback.fixedVolume.description': '有効にすると、ECHO の音量制御を 100% に固定します。ReplayGain は独立して適用されます。',
  'settings.playback.fixedVolume.status.fixed': '固定済み',
  'settings.playback.fixedVolume.title': '固定音量',
  'settings.playback.gapless.description': 'ローカルの同一アルバムで隣接する曲だけを 0 秒間隔で再生します。標準出力では一時的にネイティブ shared 経路を使い、Automix 停止中も独立して動作します。',
  'settings.playback.gapless.title': 'アルバム・ギャップレス再生',
  'settings.playback.transportFade.curve.equalPower': '等パワー',
  'settings.playback.transportFade.curve.linear': 'リニア',
  'settings.playback.transportFade.curve.smooth': 'スムーズ',
  'settings.playback.transportFade.description': '0 ms でオフ。オンにすると、手動の再生 / 一時停止に同じフェード時間を使います。',
  'settings.playback.transportFade.field.curve': 'カーブ',
  'settings.playback.transportFade.field.duration': '長さ',
  'settings.playback.transportFade.field.fadeIn': 'フェードイン ms',
  'settings.playback.transportFade.field.fadeOut': 'フェードアウト ms',
  'settings.playback.transportFade.status.disabled': '無効',
  'settings.playback.transportFade.status.enabled': '有効',
  'settings.playback.transportFade.title': '再生 / 一時停止フェード',
  'settings.playback.issueDiagnostics.description': '既定ではオフです。再生異常の報告時に有効にすると、状態、進行、duration、native バッファ、underrun、backend、警告、ended マークを記録する小窓を表示します。',
  'settings.playback.issueDiagnostics.title': '音声問題診断ウィンドウ',
  'settings.playback.juceOutput.description': '既定ではオフです。FFmpeg 互換経路を既定出力にし、必要な時だけ手動で JUCE 出力を有効化できます。失敗時は自動で戻ります。',
  'settings.playback.juceOutput.title': 'JUCE メイン出力',
  'settings.playback.miniPlayer.action.hide': '隠す',
  'settings.playback.miniPlayer.action.show': '表示',
  'settings.playback.miniPlayer.autoHideNote': 'ミニプレイヤーを開く時にメイン画面を右下トレイへ隠す',
  'settings.playback.miniPlayer.description': '独立した透明の最前面小窓で、カバー、曲名、進行だけを表示します。透明な余白が他のアプリを邪魔しないよう、ウィンドウはプレイヤー本体に収まります。',
  'settings.playback.miniPlayer.status.hidden': '未表示',
  'settings.playback.miniPlayer.status.visible': '表示中',
  'settings.playback.miniPlayer.title': 'ミニプレイヤー',
  'settings.playback.monoAudio.description': '左右チャンネルを合成して両側へ出力します。既定ではオフで、片耳リスニング、片側が壊れたヘッドホン、ミックス確認に使えます。',
  'settings.playback.monoAudio.title': 'モノラル音声',
  'settings.playback.nativeDecode.description': '既定ではオフです。有効にすると、リサンプリング不要なローカル WAV/FLAC/MP3 で常駐ネイティブデコードを使います。MP3 は Windows Media を使い、失敗時は FFmpeg に戻ります。',
  'settings.playback.nativeDecode.title': '常駐ネイティブデコード',
  'settings.playback.hqplayer.defaultBackend.ask': '毎回確認',
  'settings.playback.hqplayer.defaultBackend.echoNative': 'ECHO 出力を使う',
  'settings.playback.hqplayer.defaultBackend.hqplayer': 'HQPlayer を優先',
  'settings.playback.hqplayer.description': 'HQPlayer の制御エンドポイントと再生受け渡し設定を準備します。既定では現在の出力を変更しません。',
  'settings.playback.hqplayer.enable': 'HQPlayer 連携を有効化',
  'settings.playback.hqplayer.field.defaultBackend': '既定の受け渡し',
  'settings.playback.hqplayer.field.endpoint': '制御エンドポイント',
  'settings.playback.hqplayer.field.lastChecked': '前回チェック',
  'settings.playback.hqplayer.field.status': '状態',
  'settings.playback.hqplayer.host': 'Host',
  'settings.playback.hqplayer.mediaServer': 'ECHO メディアサービス',
  'settings.playback.hqplayer.mode.localDesktop': 'ローカル HQPlayer Desktop',
  'settings.playback.hqplayer.mode.remote': 'リモート HQPlayer',
  'settings.playback.hqplayer.note': '現段階では設定保存と TCP 接続テストだけを行い、HQPlayer の起動や ECHO の再生チェーン変更は行いません。',
  'settings.playback.hqplayer.port': '制御ポート',
  'settings.playback.hqplayer.profileName': 'プロファイル名',
  'settings.playback.hqplayer.result.failed': '接続できません',
  'settings.playback.hqplayer.result.ok': '接続できます',
  'settings.playback.hqplayer.save': '保存',
  'settings.playback.hqplayer.saving': '保存中',
  'settings.playback.hqplayer.status.available': '利用可能',
  'settings.playback.hqplayer.status.checking': '確認中',
  'settings.playback.hqplayer.status.disabled': '無効',
  'settings.playback.hqplayer.status.notConfigured': 'ポート未設定',
  'settings.playback.hqplayer.status.unavailable': '利用不可',
  'settings.playback.hqplayer.test': '接続テスト',
  'settings.playback.hqplayer.testing': 'テスト中',
  'settings.playback.hqplayer.title': 'HQPlayer 連携',
  'settings.playback.speedMode.description': '下部プレイヤーの速度スライダーで使う変速方式を選びます。',
  'settings.playback.speedMode.title': '変速モード',
  'settings.playback.outputMode.description': '一般的なヘッドホン、Bluetooth、PC スピーカーには標準出力を推奨します。WASAPI / ASIO / Exclusive は外部オーディオ機器や HiFi 調整向けです。',
  'settings.playback.outputMode.exclusive': 'Exclusive',
  'settings.playback.outputMode.shared': 'Shared',
  'settings.playback.outputMode.system': '標準出力（推奨）',
  'settings.playback.sharedBackend.description': 'DirectSound は手動の互換モードです。遅延が大きいため、普段は WASAPI Shared を使います。',
  'settings.playback.sharedBackend.alsa': 'ALSA',
  'settings.playback.sharedBackend.auto': '自動',
  'settings.playback.sharedBackend.directSound': 'DirectSound 互換',
  'settings.playback.sharedBackend.linuxDescription': 'Linux では既定で ALSA を優先します。PipeWire が ALSA 互換レイヤーに接続されている場合も、この共有出力経路を使います。',
  'settings.playback.sharedBackend.title': '共有バックエンド',
  'settings.playback.sharedBackend.wasapi': 'WASAPI Shared',
  'settings.playback.outputDevice.title': '出力デバイス',
  'settings.playback.outputDevice.description': 'echo-audio-host から取得したデバイス一覧です。デバイスがない場合は既定出力を維持します。',
  'settings.playback.outputDevice.empty': '利用可能なデバイスなし',
  'settings.playback.resetEngine.action': '音声エンジンを再起動',
  'settings.playback.resetEngine.busy': '再起動中',
  'settings.playback.resetEngine.description': '現在の再生を停止して native 音声ホストを解放します。デバイスやドライバーが固まった時に、アプリ再起動の前に試せます。',
  'settings.playback.resetEngine.done': '音声エンジンを再起動しました。もう一度再生できます',
  'settings.playback.resetEngine.title': '音声エンジンを再起動',
  'settings.playback.segmentLoop.description': '現在の曲の A/B 点を設定し、区間ループを有効化して、この曲の区間ブックマークとして保存します。',
  'settings.playback.segmentLoop.title': 'A-B ループ',
  'settings.playback.replayGain.action.advanced': '詳細',
  'settings.playback.replayGain.action.analyzeMissing': '未解析の音量を分析',
  'settings.playback.replayGain.action.analyzing': '分析中...',
  'settings.playback.replayGain.description': '曲ごとの聴感音量をそろえます。タグを読むか ECHO データベースに書き込むだけで、音楽ファイルは変更しません。',
  'settings.playback.replayGain.error': '音量分析エラー {count} 件。問題のあるファイルはスキップしました。',
  'settings.playback.replayGain.field.applied': '現在の適用',
  'settings.playback.replayGain.field.mode': 'モード',
  'settings.playback.replayGain.field.preventClipping': 'クリップ防止',
  'settings.playback.replayGain.field.preamp': 'プリアンプ',
  'settings.playback.replayGain.field.progress': '進行',
  'settings.playback.replayGain.field.target': '目標ラウドネス',
  'settings.playback.replayGain.mode.album': 'アルバム',
  'settings.playback.replayGain.mode.off': 'オフ',
  'settings.playback.replayGain.mode.track': 'トラック',
  'settings.playback.replayGain.notRun': '未実行',
  'settings.playback.replayGain.preset.quiet': '静かめ (-18 LUFS)',
  'settings.playback.replayGain.preset.standard': '標準 (-14 LUFS)',
  'settings.playback.replayGain.status.disabled': '無効',
  'settings.playback.replayGain.status.enabled': '有効',
  'settings.playback.replayGain.title': '音量ノーマライズ',
  'settings.playback.replayGain.toggle.analyzeOnPlay': '再生時に分析',
  'settings.playback.replayGain.toggle.analyzeOnScan': 'スキャン後に分析',
  'settings.playback.replayGain.toggle.preventClipping': 'クリップ防止',
  'settings.playback.status.off': 'オフ',
  'settings.playback.status.on': 'オン',
  'settings.playback.troubleshooting.description': '音が固まったりデバイス一覧が不正な時に使います。ソフト再起動は他のアプリに影響しません。',
  'settings.playback.troubleshooting.hardAction': 'Windows Audio サービスを再起動',
  'settings.playback.troubleshooting.hardBusy': 'Windows Audio サービスを再起動中',
  'settings.playback.troubleshooting.hardConfirm': 'これはすべてのアプリの音声（Chrome、ゲーム、通話）を中断し、管理者権限が必要です。続行しますか？',
  'settings.playback.troubleshooting.hardDone': 'Windows Audio サービスが復旧しました。もう一度再生できます',
  'settings.playback.troubleshooting.softAction': '音声エンジンを再起動',
  'settings.playback.troubleshooting.softBusy': '音声エンジンを再起動中',
  'settings.playback.troubleshooting.softDone': '音声エンジンを再起動しました。もう一度再生できます',
  'settings.playback.troubleshooting.title': '音声トラブルシューティング',
  'settings.playback.wireless.title': 'ワイヤレス再生',
  'settings.playback.wireless.description': '今後の HiFi エンジン段階で接続します。現段階では gapless / automix / ストリーミングは移行しません。',
  'settings.playback.audioStatus.title': '音声状態',
  'settings.playback.audioStatus.description': 'サンプルレート欄を分けて表示し、旧 ECHO の排他モード 48k 固定の再発を避けます。',
  'settings.playback.automix.description': '既定ではオフです。有効にすると、連続キューで次の曲を先に準備し、ネイティブのデュアル Deck エンジンで終端の無音を避けながら自然につなぎます。',
  'settings.playback.automix.title': 'Automix スマート遷移',
  'settings.playback.stability.action.copied': 'コピーしました',
  'settings.playback.stability.action.copy': '診断情報をコピー',
  'settings.playback.stability.action.refresh': '再生安定性診断を更新',
  'settings.playback.stability.error.desktopBridgeUnavailable': 'デスクトップブリッジを利用できません。',
  'settings.playback.stability.field.lastSharedStabilityRecoveryAt': '前回の Shared 安定化復旧時刻',
  'settings.playback.stability.field.lastWatchdogRecoveryTime': '前回の watchdog 復旧時刻',
  'settings.playback.stability.field.nativeBufferedFrames': 'Native バッファーフレーム',
  'settings.playback.stability.field.nativeBufferedMs': 'Native バッファー ms',
  'settings.playback.stability.field.nativeDeviceBufferFrames': 'デバイスバッファーフレーム',
  'settings.playback.stability.field.nativeFifoCapacityFrames': 'Native FIFO 容量フレーム',
  'settings.playback.stability.field.nativeStartupPrebufferFrames': '起動プリバッファーフレーム',
  'settings.playback.stability.field.nativeUnderrunCallbacks': 'Native underrun コールバック',
  'settings.playback.stability.field.nativeUnderrunFrames': 'Native underrun フレーム',
  'settings.playback.stability.field.recentWatchdogRecoveryCount': '最近の watchdog 復旧回数',
  'settings.playback.stability.field.sharedStabilityTier': 'Shared 安定性ティア',
  'settings.playback.stability.field.watchdogStatus': 'watchdog 状態',
  'settings.playback.stability.title': '再生安定性診断',
  'settings.playback.stability.value.unknown': '不明',
  'settings.integrations.discord.action.refresh': '状態を更新',
  'settings.integrations.discord.title': 'Discord ステータス',
  'settings.integrations.discord.description': '現在の再生状態を Discord Rich Presence に同期し、曲名、アーティスト、進行状況、再生状態を表示します。',
  'settings.integrations.smtc.description': '現在の再生情報、アートワーク、進行状況、メディアキー操作を Windows の音量フライアウトとロック画面へ公開します。',
  'settings.integrations.smtc.action.restart': 'SMTC を再起動',
  'settings.integrations.smtc.action.restarting': '再起動中...',
  'settings.integrations.taskbarPlayback.description': 'Windows タスクバー アイコンに再生進行状況を表示し、プレビューに前へ、再生/一時停止、次へのボタンを出します。',
  'settings.integrations.taskbarPlayback.title': 'タスクバー音楽コントロール',
  'settings.integrations.smtc.title': 'Windows メディア コントロール',
  'settings.integrations.lastfm.action.completeAuth': '認証を完了',
  'settings.integrations.lastfm.action.connect': 'Last.fm に接続',
  'settings.integrations.lastfm.action.disconnect': '切断',
  'settings.integrations.lastfm.action.refresh': '状態を更新',
  'settings.integrations.lastfm.activeProgress': '{artist} - {title} · {played}/{threshold} 秒',
  'settings.integrations.lastfm.activeTrack': '現在の曲',
  'settings.integrations.lastfm.connection.description': 'ブラウザー認証を推奨します。Last.fm で Allow を押した後、ECHO Next に戻って認証を完了してください。',
  'settings.integrations.lastfm.connection.title': 'Last.fm 接続',
  'settings.integrations.lastfm.description': 'メインプロセスでローカル再生を記録し、ファイルパス、歌詞、アートワークは送信しません。',
  'settings.integrations.lastfm.lastNowPlaying': '前回の Now Playing',
  'settings.integrations.lastfm.lastScrobble': '前回の Scrobble',
  'settings.integrations.lastfm.never': '未送信',
  'settings.integrations.lastfm.noActiveTrack': 'アクティブな曲なし',
  'settings.integrations.lastfm.nowPlaying.description': '再生開始時に現在の曲情報を一度送信します。',
  'settings.integrations.lastfm.nowPlaying.title': 'Last.fm Now Playing',
  'settings.integrations.lastfm.scrobbling.description': '曲が Last.fm の記録しきい値に達したら再生記録を送信します。',
  'settings.integrations.lastfm.scrobbling.title': 'Last.fm Scrobbling',
  'settings.integrations.lastfm.status.connected': '接続済み {username}',
  'settings.integrations.lastfm.status.error': 'エラー: {error}',
  'settings.integrations.lastfm.status.notConnected': '未接続',
  'settings.integrations.lastfm.status.pending': '認証完了待ち',
  'settings.integrations.lastfm.statusLabel': '状態',
  'settings.integrations.lastfm.title': 'Last.fm',
  'settings.integrations.mobile.title': 'スマホリモコン',
  'settings.integrations.mobile.description': '将来の外部デバイス機能は制御された IPC を通し、Renderer がシステムリソースへ直接接続しないようにします。',
  'settings.integrations.accounts.cookieFallback': 'ログイン後に Cookie は自動保存されます。手動貼り付けは予備手段です。',
  'settings.integrations.accounts.cookiePlaceholder': 'Cookie を貼り付けて保存',
  'settings.integrations.accounts.description.default': '歌詞、メタデータ、ダウンロード連携用の予約枠です。',
  'settings.integrations.accounts.description.bilibili': 'MV 解析と高画質再生に使います。',
  'settings.integrations.accounts.loginAndSync': 'ログインして同期',
  'settings.integrations.accounts.clickToLogin': '未ログイン クリックしてログイン',
  'settings.integrations.accounts.logout': 'ログアウト',
  'settings.integrations.accounts.logoutBusy': 'ログアウト中...',
  'settings.integrations.accounts.manualSave': '手動保存',
  'settings.integrations.accounts.manualSaveBusy': '保存中...',
  'settings.integrations.accounts.check': '確認',
  'settings.integrations.accounts.checkBusy': '確認中...',
  'settings.integrations.accounts.loginBusy': 'ログイン待ち...',
  'settings.integrations.accounts.loginMeta': 'ログイン {loginAt} · 確認 {checkedAt}',
  'settings.integrations.accounts.loginStatus': 'ログイン状態',
  'settings.integrations.accounts.soundcloudNote': 'SoundCloud のストリーミング再生はここに保存したログイン Cookie を使います。Artist Pro や開発者 API は不要です。',
  'settings.integrations.accounts.osuNote': 'osu! 譜面ダウンロードはここに保存したログイン Cookie を優先します。公式が失敗した場合は Sayobot、Catboy、NeriNyan ミラーを自動で試します。',
  'settings.integrations.accounts.youtube.browser': 'ブラウザー',
  'settings.integrations.accounts.youtube.browserNone': '使用しない',
  'settings.integrations.accounts.youtube.description': 'システムブラウザーのログイン状態を流用し、後続の解析やダウンロードで使います。',
  'settings.integrations.accounts.youtube.savedStatus': 'ブラウザーを選ぶとシステムブラウザーのログイン状態を保存します。',
  'settings.integrations.accounts.spotify.description': '公式プレイヤー連携です。Premium が必要です。上の設定で自分の Spotify Client ID を入力し、Spotify Dashboard にリダイレクト URI を登録してください。',
  'settings.integrations.accounts.spotify.login': 'Spotify にログイン',
  'settings.integrations.accounts.spotify.loginBusy': '認証待ち...',
  'settings.integrations.accounts.spotify.savedStatus': 'OAuth PKCE を使い、Client Secret は保存しません。ダウンロード機能は Spotify では使えません。',
  'settings.integrations.accountPanel.title': 'アカウントログイン',
  'settings.integrations.accountPanel.description': '各プラットフォームのログイン状態を保存し、後続の歌詞、メタデータ、MV、ダウンロード、ストリーミング連携で使います。Cookie はログイン後に自動保存されます。',
  'settings.integrations.accountPanel.refreshAll': 'すべて更新',
  'settings.integrations.accountStartupRefresh.title': '起動時にアカウント状態を更新',
  'settings.integrations.accountStartupRefresh.description': '以前ログインしたことがあるアカウントだけを確認します。一度もログインしていないプラットフォームは静かなままです。',
  'settings.integrations.accountExpiryNotices.title': 'アカウント失効通知をオフにする',
  'settings.integrations.accountExpiryNotices.description': '有効にすると、アカウント失効時に左上の通知を出さなくなります。アカウント状態はここで引き続き確認できます。',
  'settings.integrations.credentialPanel.title': '開発者 / API 設定',
  'settings.integrations.credentialPanel.description': 'Spotify、TIDAL、Discogs、オンライン歌手、Last.fm の設定です。使わないなら折りたたんだままにできます。',
  'settings.integrations.credentialPanel.expand': 'API 設定を展開',
  'settings.integrations.credentialPanel.collapse': 'API 設定を折りたたむ',
  'settings.integrations.smtcLyrics.title': 'SMTC 歌詞表示',
  'settings.integrations.smtcLyrics.description': '現在の歌詞行を Windows のメディア情報へ追加できます。既定ではオフで、アーティスト欄が汚れるのを避けます。',
  'settings.integrations.spotifyAutoLaunchOfficialPlayer.title': 'Spotify で公式プレイヤーを自動起動',
  'settings.integrations.spotifyAutoLaunchOfficialPlayer.description': 'Spotify 再生時に、ECHO 内蔵 SDK が DRM の都合で使えない場合は、Spotify デスクトップ版または Web 版を自動で開いて Connect デバイスを引き継ぎます。',
  'settings.integrations.networkProxy.title': 'ネットワークプロキシ',
  'settings.integrations.networkProxy.description': 'ログインページ、ネットワーク取得のカバー、歌詞、MV 検索、メタデータ補完で使います。メディア再生ストリームは既定でプロキシを通さず、バッファや Range リクエストへの影響を避けます。',
  'settings.integrations.networkProxy.mode': 'モード',
  'settings.integrations.networkProxy.modeAria': 'ネットワークプロキシモード',
  'settings.integrations.networkProxy.mode.off': 'オフ',
  'settings.integrations.networkProxy.mode.system': 'システムプロキシ',
  'settings.integrations.networkProxy.mode.manual': '手動プロキシ',
  'settings.integrations.networkProxy.manualUrl': '手動プロキシアドレス',
  'settings.integrations.networkProxy.manualPlaceholder': 'http://127.0.0.1:7890 または socks5://127.0.0.1:7890',
  'settings.integrations.networkProxy.pacUrl': 'PAC アドレス',
  'settings.integrations.networkProxy.bypass': '除外アドレス',
  'settings.integrations.networkProxy.save': '保存して適用',
  'settings.integrations.networkProxy.saveBusy': '保存中...',
  'settings.integrations.networkProxy.test': '接続テスト',
  'settings.integrations.networkProxy.testBusy': 'テスト中...',
  'settings.integrations.networkProxy.note': '初版では通常のネットワーク機能だけを既定でプロキシします。リモートライブラリと再生バイトストリームは直結のままにして、再生中の安定性を守ります。',
  'settings.remote.hero.title': 'クラウド / リモート音楽ライブラリ',
  'settings.remote.hero.summary': 'クラウド / WebDAV / AList / NAS / Subsonic / Jellyfin / Emby',
  'settings.remote.hero.description': 'AList、Nutstore、Nextcloud などの WebDAV ストレージに接続でき、Jellyfin、Emby、Navidrome、NAS、SSHFS を独立した音楽ソースとして閲覧することもできます。ECHO はリモート楽曲のローカル索引を作成し、歌詞、MV、再生位置、お気に入り、履歴が正常に動作するようにします。',
  'settings.remote.guardrail.aria': 'リモートライブラリ同期の境界',
  'settings.remote.guardrail.title': 'ローカル再生を優先',
  'settings.remote.guardrail.description': 'リモート同期とジャケット/メタデータ補完はすべてバックグラウンドで帯域制限付き実行されます。再生が活発なときは並列数を下げます。現在のオフライン境界は索引、ジャケット、小さなメタデータキャッシュまでで、ライブラリ全体の音楽ファイルを無言でミラーしません。',
  'settings.remote.coverPerformance.aria': 'リモートジャケット読み込み性能',
  'settings.remote.coverPerformance.title': '読み込み性能',
  'settings.remote.coverPerformance.description': 'リモートジャケットの先読み強度を調整します。リストのジャケット読み込みにだけ影響し、再生ストリーム取得は変えません。',
  'settings.remote.coverPerformance.groupAria': 'リモートジャケット読み込み性能プリセット',
  'settings.remote.coverPerformance.option.low': '省データ',
  'settings.remote.coverPerformance.option.low.description': '現在見えているジャケットだけ先読みします。公衆回線や非力なサーバー向けです。',
  'settings.remote.coverPerformance.option.balanced': 'バランス',
  'settings.remote.coverPerformance.option.balanced.description': '現在位置とその先およそ半画面から1画面分を先読みします。既定の推奨設定です。',
  'settings.remote.coverPerformance.option.aggressive': '積極先読み',
  'settings.remote.coverPerformance.option.aggressive.description': 'スクロール停止時により多くのジャケットを先に取得します。LAN 内の Navidrome 向けです。',
  'settings.remote.coverPerformance.option.lan': 'LAN 最速',
  'settings.remote.coverPerformance.option.lan.description': 'リモートジャケット先読みとバックグラウンド読み込みの並列度を最大にします。ローカル、NAS、安定したギガビット LAN 向けです。',
  'settings.remote.albumMerge.aria': 'リモートアルバム統合ポリシー',
  'settings.remote.albumMerge.title': 'アルバム統合',
  'settings.remote.albumMerge.description': 'クラウド / リモートのアルバム一覧での表示グループ化にだけ影響します。ローカルライブラリもファイルタグも変えず、再生にも影響しません。',
  'settings.remote.albumMerge.groupAria': 'リモートアルバム統合プリセット',
  'settings.remote.albumMerge.option.conservative': '保守的に統合',
  'settings.remote.albumMerge.option.conservative.description': 'まずサーバー側のアルバム ID を優先します。通常のクラウドでは同じソース、同じフォルダー、同じアルバムの曲だけを統合します。',
  'settings.remote.albumMerge.option.standard': '標準統合',
  'settings.remote.albumMerge.option.standard.description': '保守的な境界を保ちつつタイトル差異の許容を広げ、大小文字、記号、- Single のようなリモート側の分割を統合します。',
  'settings.remote.albumMerge.stat.current': '元のアルバム数',
  'settings.remote.albumMerge.stat.target': '統合後の数',
  'settings.remote.albumMerge.stat.tracks': '索引済みリモート楽曲',
  'settings.remote.albumMerge.pending': '未スキャン',
  'settings.remote.albumMerge.action.scan': 'リモート楽曲をスキャン',
  'settings.remote.albumMerge.action.scanning': 'スキャン中...',
  'settings.remote.albumMerge.action.apply': '適用して再整理',
  'settings.remote.albumMerge.action.applying': '再整理中...',
  'settings.remote.library.title': 'リモート音楽ライブラリ',
  'settings.remote.library.description': 'この段階ではクラウド / リモート / ストリーミングを禁止し、設定グループの場所だけ残します。',
  'segmentLoop.action.clear': '現在の A-B 点をクリア',
  'segmentLoop.action.deleteBookmark': '区間ブックマーク {label} を削除',
  'segmentLoop.action.deleteBookmarkTitle': '区間ブックマークを削除',
  'segmentLoop.action.loopBookmark': '区間 {label} をループ',
  'segmentLoop.action.loopBookmarkTitle': '{label} をループ',
  'segmentLoop.action.saveBookmark': '現在の区間ブックマークを保存',
  'segmentLoop.action.setA': '現在位置を A 点に設定',
  'segmentLoop.action.setB': '現在位置を B 点に設定',
  'segmentLoop.action.toggle': 'A-B ループを切り替え',
  'segmentLoop.action.toggleTitle': 'A-B ループをオン/オフ',
  'segmentLoop.aria.bookmarks': '現在の曲の区間ブックマーク',
  'segmentLoop.aria.panel': 'A-B ループと区間ブックマーク',
  'segmentLoop.empty': '区間を保存するとここに表示されます',
  'segmentLoop.notSet': '未設定',
  'spotifyPlayback.error.noDevice': '利用可能な Spotify 再生デバイスがありません。「公式プレイヤーを自動起動」を有効にするか、Spotify デスクトップ版または Web 版を先に開いてください。{hint}',
  'spotifyPlayback.error.noDrmKeysystem': '現在の Electron ビルドには利用可能な DRM/Widevine keysystem がないため、Spotify 公式プレイヤーを ECHO 内でデバイス登録できません。',
  'settings.appearance.theme.title': 'テーマ',
  'settings.appearance.theme.description': 'ライト、ダーク、またはシステム設定に合わせます。',
  'settings.appearance.theme.light': 'ライト',
  'settings.appearance.theme.dark': 'ダーク',
  'settings.appearance.theme.followSystem': 'システムに合わせる',
  'settings.appearance.themeSchedule.title': 'ダークモードの自動切り替え',
  'settings.appearance.themeSchedule.description': 'システム時刻に合わせて指定時刻にダークへ切り替え、設定した時刻にライトへ戻します。',
  'settings.appearance.themeSchedule.toggle': 'スケジュールを有効化',
  'settings.appearance.themeSchedule.toggleAria': 'ダークモード自動切り替えを有効化',
  'settings.appearance.themeSchedule.darkAt': 'ダークに切り替え',
  'settings.appearance.themeSchedule.lightAt': 'ライトに戻す',
  'settings.appearance.themeSchedule.status.enabled': '有効です: {darkAt} に{mode}へ切り替え、{lightAt} に自動でライトへ戻します。現在はローカル時刻に従って{mode}を使用中です。',
  'settings.appearance.themeSchedule.status.disabled': 'オフのときは上の手動テーマ設定をそのまま使います。',
  'settings.appearance.sidebar.title': 'サイドバー',
  'settings.appearance.sidebar.description': 'サイドバー項目の順序と表示状態を調整します。ページ内容や再生経路は変更しません。',
  'settings.appearance.sidebar.expand': 'サイドバー配置を展開',
  'settings.appearance.sidebar.collapse': 'サイドバー配置を閉じる',
  'settings.appearance.sidebar.mainGroup': 'メインナビ',
  'settings.appearance.sidebar.utilityGroup': '下部項目',
  'settings.appearance.sidebar.reset': '初期状態に戻す',
  'settings.appearance.sidebar.visible': '表示',
  'settings.appearance.sidebar.hidden': '非表示',
  'settings.appearance.sidebar.fixed': '固定表示',
  'settings.appearance.sidebar.noItems': 'このグループには調整できる項目がありません。',
  'settings.appearance.sidebar.summary.allVisible': 'すべて表示',
  'settings.appearance.sidebar.summary.hidden': '{count} 個を非表示',
  'settings.appearance.sidebar.count': '{count} 件',
  'settings.appearance.sidebar.moveUp': '上へ移動',
  'settings.appearance.sidebar.moveDown': '下へ移動',
  'settings.appearance.sidebar.moveUpAria': '{label} を上へ移動',
  'settings.appearance.sidebar.moveDownAria': '{label} を下へ移動',
  'settings.appearance.sidebar.hideAria': '{label} を隠す',
  'settings.appearance.sidebar.showAria': '{label} を表示',
  'settings.appearance.nowPlayingCoverColor.title': '再生画面のカバー色',
  'settings.appearance.nowPlayingCoverColor.description': '有効にすると、再生中ページがアイドル時に小さなカバー画像から軽量な背景色を抽出します。低負荷モードでは自動的にスキップします。既定はオフです。',
  'settings.appearance.albumCoverShape.title': 'アルバムカバー形状',
  'settings.appearance.albumCoverShape.description': 'アルバムアートを角丸または四角で表示します。この設定はテーマプリセットより優先されます。既定は角丸です。',
  'settings.appearance.albumCoverShape.rounded': '角丸',
  'settings.appearance.albumCoverShape.square': '四角',
  'settings.appearance.wallpaper.title': 'カスタム背景',
  'settings.appearance.wallpaper.description': '横向きと縦向きの背景を別々に保存します。縦向きウィンドウでは縦向き背景だけを適用します。画像とローカル動画に対応します。',
  'settings.appearance.wallpaper.choose': '横向き背景を選択',
  'settings.appearance.wallpaper.clear': '横向き背景をクリア',
  'settings.appearance.wallpaper.portraitChoose': '縦向き背景を選択',
  'settings.appearance.wallpaper.portraitClear': '縦向き背景をクリア',
  'settings.appearance.wallpaper.landscapePath': '横向き',
  'settings.appearance.wallpaper.portraitPath': '縦向き',
  'settings.appearance.wallpaper.videoStatus': '動画壁紙 ・ ミュートループ',
  'settings.appearance.wallpaper.videoPause.smart': '自動一時停止',
  'settings.appearance.wallpaper.videoPause.minimized': '最小化で停止',
  'settings.appearance.wallpaper.videoPause.never': '常に再生',
  'settings.appearance.wallpaper.scale': '壁紙スケール',
  'settings.appearance.wallpaper.blur': '壁紙ぼかし',
  'settings.appearance.wallpaper.brightness': '壁紙の明るさ',
  'settings.appearance.wallpaper.uiOpacity': 'UI 透明度',
  'settings.appearance.wallpaper.visualProtection': '視認性保護',
  'settings.appearance.wallpaper.unifiedOpacity': '透明度を統一',
  'settings.appearance.themePreset.title': 'テーマプリセット',
  'settings.appearance.themePreset.description': 'アプリ全体のグラデーション色板を選びます。ライト/ダーク設定はそのまま使われます。',
  'settings.appearance.themePreset.classic': 'Classic ECHO Next',
  'settings.appearance.themePreset.classic.description': '白とライトグレーを基調に、控えめなブルーパープルを添えた Roon 風の見た目です。',
  'settings.appearance.themePreset.echoTwilight': 'Twilight Peach Mist',
  'settings.appearance.themePreset.echoTwilight.description': '旧 ECHO らしい暖かいピンクのグラデーション。',
  'settings.appearance.themePreset.sakuraMilk': 'Sakura Milk',
  'settings.appearance.themePreset.sakuraMilk.description': 'ミルキーなピンクにチェリーレッドのアクセント。',
  'settings.appearance.themePreset.peachSoda': 'Peach Soda',
  'settings.appearance.themePreset.peachSoda.description': 'ピーチオレンジとソーダミントの軽い組み合わせ。',
  'settings.appearance.themePreset.mintCandy': 'Mint Candy',
  'settings.appearance.themePreset.mintCandy.description': 'ミント、クリーム、少しのピーチピンク。',
  'settings.appearance.themePreset.berryDream': 'Berry Dream',
  'settings.appearance.themePreset.berryDream.description': 'ベリーパープルと雲の白、夢っぽいピンクの光。',
  'settings.appearance.themePreset.matchaCream': 'Matcha Cream',
  'settings.appearance.themePreset.matchaCream.description': '抹茶グリーンとクリームイエローの落ち着いた配色。',
  'settings.appearance.themePreset.lemonMochi': 'Lemon Mochi',
  'settings.appearance.themePreset.lemonMochi.description': 'Milky lemon yellow with a soft sky-blue lift.',
  'settings.appearance.themePreset.cottonCloud': 'Cotton Cloud',
  'settings.appearance.themePreset.cottonCloud.description': 'Cloud white, gentle blue, and a soft pink accent.',
  'settings.appearance.themePreset.melonCream': 'Melon Cream',
  'settings.appearance.themePreset.melonCream.description': 'Melon green over cream, cute and readable.',
  'settings.appearance.themePreset.seaSaltJelly': 'Sea Salt Jelly',
  'settings.appearance.themePreset.seaSaltJelly.description': 'Sea-salt cyan with a peachy jelly glow.',
  'settings.appearance.themePreset.caramelPudding': 'Caramel Pudding',
  'settings.appearance.themePreset.caramelPudding.description': 'Creamy caramel with a strawberry glow, sweet but readable.',
  'settings.appearance.themePreset.neonCandy': 'Neon Candy',
  'settings.appearance.themePreset.neonCandy.description': 'Violet neon, pink highlights, and mint bubbles.',
  'settings.appearance.themePreset.nyanCat': 'Nyan Cat',
  'settings.appearance.themePreset.nyanCat.description': 'ゆっくり流れるかわいい虹色グラデーション。進捗バーには虹色の猫が走ります。',
  'settings.appearance.themePreset.childrenDoodle': 'こどもの日ドゥードル',
  'settings.appearance.themePreset.childrenDoodle.description': '紙の質感、クレヨンの線、にぎやかなステッカーで手帳風に。',
  'settings.appearance.themePreset.wisteriaBubble': 'Wisteria Bubble',
  'settings.appearance.themePreset.wisteriaBubble.description': 'Wisteria mist with mint bubbles, dreamy but fresh.',
  'settings.appearance.themePreset.strawberryCookie': 'Strawberry Cookie',
  'settings.appearance.themePreset.strawberryCookie.description': 'Cream-cookie warmth with strawberry red and baked gold.',
  'settings.appearance.themePreset.graphiteAurora': 'Graphite Aurora',
  'settings.appearance.themePreset.graphiteAurora.description': 'Graphite gray with a quiet green aurora edge.',
  'settings.appearance.themePreset.amberNoir': 'Amber Noir',
  'settings.appearance.themePreset.amberNoir.description': 'Black-gold listening room tones for long dark sessions.',
  'settings.appearance.themePreset.oceanStudio': 'Ocean Studio',
  'settings.appearance.themePreset.oceanStudio.description': 'Cool blue-gray and sea mist for a clean studio feel.',
  'settings.appearance.themePreset.rosewoodVinyl': 'Rosewood Vinyl',
  'settings.appearance.themePreset.rosewoodVinyl.description': 'Warm rosewood reds with a grounded vinyl mood.',
  'settings.appearance.themePreset.darkSideMoon': 'The Dark Side of the Moon',
  'settings.appearance.themePreset.darkSideMoon.description': 'Pink Floyd へのトリビュート。黒い月面、白いプリズム、虹色のスペクトル。',
  'settings.appearance.themePreset.shibuyaNight': '渋谷ナイト',
  'settings.appearance.themePreset.shibuyaNight.description': '東京ネオン、夜紫の交差点、シアンの看板光。',
  'settings.appearance.themePreset.kyotoKurenai': '京都くれない',
  'settings.appearance.themePreset.kyotoKurenai.description': '鳥居の朱、和紙の温かさ、お守りの金色。',
  'settings.appearance.themePreset.ukiyoIndigo': '浮世インディゴ',
  'settings.appearance.themePreset.ukiyoIndigo.description': '浮世絵の波を思わせる藍、紙色、古金。',
  'settings.appearance.themePreset.fujiSnow': '富士初雪',
  'settings.appearance.themePreset.fujiSnow.description': '雪白、富士ブルー、淡い桜のハイライト。',
  'settings.appearance.themePreset.matsuriLantern': '祭り提灯',
  'settings.appearance.themePreset.matsuriLantern.description': '夏祭りの提灯赤、夜店の金、温かな紙色。',
  'settings.appearance.themePreset.ginzaNoir': '銀座ノワール',
  'settings.appearance.themePreset.ginzaNoir.description': '黒曜石、シャンパンゴールド、ショーウィンドウの青。',
  'settings.appearance.themePreset.frostJazz': 'フロストジャズ',
  'settings.appearance.themePreset.frostJazz.description': '冷たいブルージャズに梅紫のステージライト。',
  'settings.appearance.themePreset.FINAL': 'FINAL',
  'settings.appearance.themePreset.FINAL.description': 'final公式のモノクロ製品写真、音響工学、8K SOUNDの言葉から着想した、抑制された精密なモニター調。',
  'settings.appearance.themeCustom.title': 'Customize Current Theme',
  'settings.appearance.themeCustom.description': 'Choose a theme first, then tune colors. Each theme keeps its own custom colors.',
  'settings.appearance.themeCustom.action.autoFix': 'Auto-fix Text',
  'settings.appearance.themeCustom.action.create': 'New My Theme',
  'settings.appearance.themeCustom.action.rename': 'Rename',
  'settings.appearance.themeCustom.action.duplicate': 'Duplicate',
  'settings.appearance.themeCustom.action.delete': 'Delete',
  'settings.appearance.themeCustom.action.copyLightToDark': 'Copy Light to Dark',
  'settings.appearance.themeCustom.action.copyDarkToLight': 'Copy Dark to Light',
  'settings.appearance.themeCustom.action.export': 'Export Parameters',
  'settings.appearance.themeCustom.action.import': 'Import Parameters',
  'settings.appearance.themeCustom.action.reset': 'Reset Custom Colors',
  'settings.appearance.themeCustom.action.save': 'Save Custom Colors',
  'settings.appearance.themeCustom.expand': 'Expand My Theme',
  'settings.appearance.themeCustom.collapse': 'Collapse My Theme',
  'settings.appearance.themeCustom.advanced.show': 'Show Advanced Settings',
  'settings.appearance.themeCustom.advanced.hide': 'Hide Advanced Settings',
  'settings.appearance.themeCustom.field.appBg': 'Base',
  'settings.appearance.themeCustom.field.appBg2': 'Gradient Mid',
  'settings.appearance.themeCustom.field.appBg3': 'Gradient End',
  'settings.appearance.themeCustom.field.panel': 'Glass Tint',
  'settings.appearance.themeCustom.field.panelSoft': 'Soft Panel',
  'settings.appearance.themeCustom.field.accent': 'Primary Accent',
  'settings.appearance.themeCustom.field.accentStrong': 'Secondary Accent',
  'settings.appearance.themeCustom.field.secondary': 'Third Accent',
  'settings.appearance.themeCustom.field.heading': 'Main Text',
  'settings.appearance.themeCustom.field.text': 'Body Text',
  'settings.appearance.themeCustom.field.muted': 'Secondary Text',
  'settings.appearance.themeCustom.field.border': 'Border',
  'settings.appearance.themeCustom.field.onAccent': 'Accent Button Text',
  'settings.appearance.themeCustom.field.buttonText': 'Button Text',
  'settings.appearance.themeCustom.field.panelOpacity': 'Panel Opacity',
  'settings.appearance.themeCustom.field.glass': 'Glass',
  'settings.appearance.themeCustom.field.shadow': 'Shadow',
  'settings.appearance.themeCustom.field.titlebar': 'Titlebar',
  'settings.appearance.themeCustom.field.sidebar': 'Sidebar',
  'settings.appearance.themeCustom.field.player': 'Player',
  'settings.appearance.themeCustom.field.field': 'Field',
  'settings.appearance.themeCustom.field.row': 'Row',
  'settings.appearance.themeCustom.field.rowHover': 'Row Hover',
  'settings.appearance.themeCustom.field.rowActive': 'Selected Row',
  'settings.appearance.themeCustom.field.chip': 'Chip',
  'settings.appearance.themeCustom.field.focus': 'Focus Ring',
  'settings.appearance.themeCustom.field.success': 'Success',
  'settings.appearance.themeCustom.field.warning': 'Warning',
  'settings.appearance.themeCustom.field.danger': 'Danger',
  'settings.appearance.themeCustom.field.cornerRadius': 'Corner Radius',
  'settings.appearance.themeCustom.field.panelBlur': 'Panel Blur',
  'settings.appearance.themeCustom.field.saturation': 'Saturation',
  'settings.appearance.themeCustom.field.motionEnabled': 'Enable Motion',
  'settings.appearance.themeCustom.field.motionSpeed': 'Motion Speed',
  'settings.appearance.themeCustom.field.motionIntensity': 'Motion Intensity',
  'settings.appearance.themeCustom.field.appBg.description': 'Main window base color',
  'settings.appearance.themeCustom.field.appBg2.description': 'Soft middle stop of the background gradient',
  'settings.appearance.themeCustom.field.appBg3.description': 'End stop of the background gradient',
  'settings.appearance.themeCustom.field.panel.description': 'Frosted panel tint',
  'settings.appearance.themeCustom.field.panelSoft.description': 'Sidebar and softer panels',
  'settings.appearance.themeCustom.field.accent.description': 'Main interactions',
  'settings.appearance.themeCustom.field.accentStrong.description': 'Gradient and depth',
  'settings.appearance.themeCustom.field.secondary.description': 'Highlight accents',
  'settings.appearance.themeCustom.field.heading.description': 'Titles and primary copy',
  'settings.appearance.themeCustom.field.text.description': 'Body text, artists, and settings copy',
  'settings.appearance.themeCustom.field.muted.description': 'Supporting copy',
  'settings.appearance.themeCustom.field.border.description': 'Card borders and dividers',
  'settings.appearance.themeCustom.field.onAccent.description': 'Text on accent buttons',
  'settings.appearance.themeCustom.field.buttonText.description': 'Regular buttons and chips',
  'settings.appearance.themeCustom.field.panelOpacity.description': 'How much background shows through panels',
  'settings.appearance.themeCustom.field.glass.description': 'Blur and glass layering',
  'settings.appearance.themeCustom.field.shadow.description': 'Cards, popups, and player shadows',
  'settings.appearance.themeCustom.field.titlebar.description': 'Top window bar background',
  'settings.appearance.themeCustom.field.sidebar.description': 'Left navigation and softer layers',
  'settings.appearance.themeCustom.field.player.description': 'Bottom player background',
  'settings.appearance.themeCustom.field.field.description': 'Inputs and search fields',
  'settings.appearance.themeCustom.field.row.description': 'Normal list row background',
  'settings.appearance.themeCustom.field.rowHover.description': 'Hovered list row background',
  'settings.appearance.themeCustom.field.rowActive.description': 'Selected list row background',
  'settings.appearance.themeCustom.field.chip.description': 'Filter chips and small buttons',
  'settings.appearance.themeCustom.field.focus.description': 'Keyboard focus and outline highlight',
  'settings.appearance.themeCustom.field.success.description': 'Success state notices',
  'settings.appearance.themeCustom.field.warning.description': 'Warning state notices',
  'settings.appearance.themeCustom.field.danger.description': 'Danger action notices',
  'settings.appearance.themeCustom.field.cornerRadius.description': 'Panel and button radius',
  'settings.appearance.themeCustom.field.panelBlur.description': 'Glass panel blur radius',
  'settings.appearance.themeCustom.field.saturation.description': 'Overall UI color strength',
  'settings.appearance.themeCustom.field.motionEnabled.description': 'Only writes CSS transition variables',
  'settings.appearance.themeCustom.field.motionSpeed.description': 'CSS animation duration',
  'settings.appearance.themeCustom.field.motionIntensity.description': 'CSS movement and emphasis strength',
  'settings.appearance.themeCustom.preview.title': 'Editing',
  'settings.appearance.themeCustom.preview.description': 'Changes preview live and are saved only when you click save.',
  'settings.appearance.themeCustom.myThemes.title': 'My Themes',
  'settings.appearance.themeCustom.myThemes.description': 'Save, switch, duplicate, import, and export safe theme parameters.',
  'settings.appearance.themeCustom.myThemes.empty': 'No custom themes yet.',
  'settings.appearance.themeCustom.group.core': 'Common Colors',
  'settings.appearance.themeCustom.group.core.description': 'Old-ECHO-style palette controls for the most visible colors.',
  'settings.appearance.themeCustom.group.gradient': 'Background Gradient',
  'settings.appearance.themeCustom.group.gradient.description': 'Controls the old-ECHO-style window gradient mood.',
  'settings.appearance.themeCustom.group.surface': 'Surface',
  'settings.appearance.themeCustom.group.surface.description': 'Titlebar, sidebar, player, and list layers.',
  'settings.appearance.themeCustom.group.state': 'State',
  'settings.appearance.themeCustom.group.state.description': 'Success, warning, danger, and focus colors.',
  'settings.appearance.themeCustom.group.motion': 'Motion',
  'settings.appearance.themeCustom.group.motion.description': 'CSS variables only, without runtime timers.',
  'settings.appearance.themeCustom.group.advanced': 'Advanced Details',
  'settings.appearance.themeCustom.group.advanced.description': 'Fine tune text, borders, and button text colors.',
  'settings.appearance.themeCustom.message.created': 'My theme was created.',
  'settings.appearance.themeCustom.message.copied': 'Copied to the target tone. Save to keep it.',
  'settings.appearance.themeCustom.message.exported': 'Theme parameters were exported.',
  'settings.appearance.themeCustom.message.imported': 'Theme parameters were imported and applied.',
  'settings.appearance.themeCustom.message.importFailed': 'Import failed. Choose an ECHO theme parameter JSON file.',
  'settings.appearance.themeCustom.message.fixed': 'Text and button colors were adjusted.',
  'settings.appearance.themeCustom.message.invalidColor': 'Use a safe #RRGGBB color.',
  'settings.appearance.themeCustom.message.lowContrast': 'Text contrast is low and may affect readability. You can auto-fix it or adjust text colors.',
  'settings.appearance.themeCustom.message.reset': 'Custom colors for this theme were reset.',
  'settings.appearance.themeCustom.message.saved': 'Custom colors for this theme were saved.',
  'settings.appearance.density.title': '表示密度',
  'settings.appearance.density.description': 'ライブラリ一覧はよりコンパクトなデスクトップ密度を使い、大きすぎるカード行は使いません。',
  'settings.appearance.density.compact': 'コンパクト',
  'settings.appearance.density.standard': '標準',
  'settings.appearance.artistAvatars.action.clear': 'アバターキャッシュを消去',
  'settings.appearance.artistAvatars.action.queueing': 'キューに追加中...',
  'settings.appearance.artistAvatars.action.refreshMissing': '不足アバターを更新',
  'settings.appearance.artistAvatars.description': '本物のアーティストアバターをバックグラウンドでゆっくり取得し、アーティストウォールでローカルキャッシュ画像を再利用します。',
  'settings.appearance.artistAvatars.fallback': '見つからない場合はアーティストのアルバムアートを使用',
  'settings.appearance.artistAvatars.message.cleared': '{removedRows} 件のアバター記録と {deletedFiles} 個のファイルを消去しました。',
  'settings.appearance.artistAvatars.message.desktopBridgeClear': 'デスクトップブリッジを利用できません。アーティストアバターを消去するには Electron で ECHO Next を開いてください。',
  'settings.appearance.artistAvatars.message.desktopBridgeRefresh': 'デスクトップブリッジを利用できません。アーティストアバターを更新するには Electron で ECHO Next を開いてください。',
  'settings.appearance.artistAvatars.message.enableFirst': '先にアーティストアバターの自動取得を有効にしてください。',
  'settings.appearance.artistAvatars.message.queued': '{queued} 件のアーティストアバターをキューに追加しました。{skipped} 件をスキップしました。',
  'settings.appearance.artistAvatars.title': 'アーティストアバター',
  'settings.appearance.artistAvatars.toggle': 'アーティストアバターを自動取得',
  'settings.devices.title': 'デバイス一覧',
  'settings.devices.empty': 'echo-audio-host から出力デバイスがまだ返っていません。',
  'settings.about.devMode.title': '開発モード',
  'settings.about.devMode.description': '現在 ECHO Next Phase 1: Library Core + Audio Host の検証中です。',
  'settings.about.nativeSqlite.title': 'ネイティブ SQLite',
  'settings.about.nativeSqlite.description': 'better-sqlite3 は dev 前に Electron ABI へ rebuild し、スキャン時のモジュール不一致を避けます。',
  'settings.about.audioHost.title': '音声ホスト',
  'settings.about.audioHost.description': 'echo-audio-host.exe は現在ローカル移行検証用です。正式リリース後は extraResources に含めます。',
  'settings.about.version.title': 'バージョン',
  'settings.about.version.description': '現在インストールされている ECHO Next のバージョンです。',
  'settings.about.updates.title': '自動更新',
  'settings.about.updates.description': '起動後に GitHub Release を自動確認し、ダウンロード完了後は自動で再起動してインストールします。',
  'settings.about.updates.currentVersion': '現在のバージョン',
  'settings.about.updates.latestVersion': '最新バージョン',
  'settings.about.updates.status': '状態',
  'settings.about.updates.lastChecked': '前回確認',
  'settings.about.updates.autoCheck': '更新を自動確認',
  'settings.about.updates.action.check': '更新を確認',
  'settings.about.updates.action.checking': '確認中...',
  'settings.about.updates.action.afdian': '愛発電',
  'settings.about.updates.action.history': '過去の更新履歴を見る',
  'settings.about.updates.action.qq': 'QQ グループに参加',
  'settings.about.updates.action.discord': 'Discord に参加',
  'settings.about.updates.progress.ready': 'ダウンロード完了、インストール準備中',
  'settings.about.updates.progress.downloading': '更新をダウンロード中',
  'settings.about.updates.progress.aria': 'OTA 更新ダウンロード進捗 {percent}%',
  'settings.about.updates.releaseNotes': '更新履歴',
  'settings.about.updates.releaseNotesPending': '更新履歴をまもなく表示します...',
  'settings.about.updates.releaseNotesEmpty': '更新履歴は GitHub Release から release notes が返ってきた後に表示されます。',
  'settings.about.updates.state.idle': '確認待ち',
  'settings.about.updates.state.checking': '確認中',
  'settings.about.updates.state.available': '新しいバージョンがあります',
  'settings.about.updates.state.downloading': 'ダウンロード中',
  'settings.about.updates.state.downloaded': 'ダウンロード完了、インストール中',
  'settings.about.updates.state.notAvailable': '最新です',
  'settings.about.updates.state.error': '確認失敗',
  'settings.about.updates.state.disabled': 'オフ',
  'settings.danger.database.kicker': 'ライブラリ DB 保護',
  'settings.danger.database.title': '復旧アシスタント',
  'settings.danger.database.badge.quarantined': '隔離済み',
  'settings.danger.database.description.loading': 'データベースの健康状態、健康スナップショット、最近の保守記録を読み込み中です。',
  'settings.danger.database.description.quarantined': '壊れた埋め込みタグや巨大テキストのためライブラリが隔離されました。ECHO は先に復旧画面を開き、音楽ファイルは削除しません。',
  'settings.danger.database.description.healthy': '現在のデータベース検査は正常です。ここに健康スナップショット、破損 DB のアーカイブ、最近の保守記録を残します。',
  'settings.danger.database.description.unrecoverable': 'データベースは健康スナップショットから復旧できません。音楽ファイルは削除されません。まず診断をエクスポートし、保護フォルダーを確認してから、破損 DB をアーカイブして空のライブラリを再構築してください。',
  'settings.danger.database.description.recoverable': 'データベースが使えない場合は、まず健康スナップショットからの復旧を試します。復旧前に現在のデータベースをアーカイブし、音楽ファイルは削除しません。',
  'settings.danger.database.health.ok': '正常',
  'settings.danger.database.health.corrupt': '破損の疑い',
  'settings.danger.database.health.unreadable': '読み取れません',
  'settings.danger.database.health.idle': '確認待ち',
  'settings.danger.database.steps.quarantined.1': '現在のライブラリはアクティブ位置から退避されており、ECHO はその危険なタグ群を読み続けません。',
  'settings.danger.database.steps.quarantined.2': 'まず「隔離ライブラリ副本を修復」を使ってください。これはアーカイブ副本だけを処理し、検証後にのみ復元します。',
  'settings.danger.database.steps.quarantined.3': '修復に失敗したら、健康スナップショットの復旧か、破損 DB をアーカイブして空ライブラリを再構築してください。音楽ファイルは削除されません。',
  'settings.danger.database.steps.unrecoverable.1': 'まずスキャンが動いていないことを確認してください。スキャン中は復旧、再構築、削除を拒否します。',
  'settings.danger.database.steps.unrecoverable.2': 'まず診断をエクスポートし、保護フォルダーを開いて破損 DB の手掛かりを残してください。',
  'settings.danger.database.steps.unrecoverable.3': '確認語「空ライブラリを再構築」を入力したあと、破損 DB をアーカイブして空ライブラリを再構築し、ライブラリフォルダーを再追加してスキャンします。',
  'settings.danger.database.steps.recoverable.1': 'まずスキャンが動いていないことを確認してください。スキャン中は復旧、再構築、削除を拒否します。',
  'settings.danger.database.steps.recoverable.2': 'まず「最新の健康スナップショットを復元」を試してください。主プロセスが列挙したスナップショットだけを受け付けます。',
  'settings.danger.database.steps.recoverable.3': '健康スナップショットがない、または復旧後も壊れている場合は「破損 DB をアーカイブして空ライブラリを再構築」を使ってください。',
  'settings.danger.database.action.check': '健康状態を確認',
  'settings.danger.database.action.checking': '確認中...',
  'settings.danger.database.action.create': '健康スナップショットを作成',
  'settings.danger.database.action.creating': '作成中...',
  'settings.danger.database.action.restore': '最新の健康スナップショットを復元',
  'settings.danger.database.action.restoring': '復元中...',
  'settings.danger.database.action.scrub': '隔離ライブラリ副本を修復',
  'settings.danger.database.action.scrubbing': '修復中...',
  'settings.danger.database.action.rebuild': '破損 DB をアーカイブして空ライブラリを再構築',
  'settings.danger.database.action.rebuilding': '再構築中...',
  'settings.danger.database.action.discard': '問題曲をアーカイブ',
  'settings.danger.database.action.discarding': 'アーカイブ中...',
  'settings.danger.database.action.relaunch': '復旧モードで再起動',
  'settings.danger.database.action.relaunching': '再起動中...',
  'settings.danger.database.action.open': '保護フォルダーを開く',
  'settings.danger.database.action.export': '診断をエクスポート',
  'settings.danger.database.action.exporting': 'エクスポート中...',
  'settings.danger.database.meta.current': '現在の DB',
  'settings.danger.database.meta.snapshot': '最新の健康スナップショット',
  'settings.danger.database.meta.snapshotHint': '手動で作成できます',
  'settings.danger.database.meta.archive': '最新の破損 DB アーカイブ',
  'settings.danger.database.meta.archiveHint': '復元/再構築の前に自動でアーカイブします',
  'settings.danger.database.meta.pending': '読み込み待ち',
  'settings.danger.database.meta.noSnapshot': '健康スナップショットなし',
  'settings.danger.database.meta.noArchive': '破損 DB アーカイブなし',
  'settings.danger.database.unavailable.scrub': '修復可能な隔離ライブラリ副本が見つかりません。保護フォルダーを開いてアーカイブが存在するか確認するか、そのまま診断をエクスポートしてください。',
  'settings.danger.database.unavailable.restore': '復元できる健康スナップショットがありません。先に健康スナップショットを作成できます。現在のライブラリが使えない場合は診断をエクスポートしてください。',
  'settings.danger.database.confirmWord': '危険操作の確認語',
  'settings.danger.database.confirmPlaceholder': '先にボタンに表示された確認語を入力してから危険操作を実行してください',
  'settings.danger.database.scanRunning': 'ライブラリスキャンが実行中です。復旧、再構築、削除は拒否されます。スキャン終了後に操作してください。',
  'settings.danger.duplicates.title': '重複曲をスキャンして整理',
  'settings.danger.duplicates.description': '先に重複グループをスキャンして一覧化します。整理時は音質や評価の低い副本を優先してごみ箱へ移し、各グループで最も評価の高い 1 曲を残します。',
  'settings.danger.duplicates.meta.result': 'スキャン結果',
  'settings.danger.duplicates.meta.resultValue': '{groups} 組 / {tracks} 曲を整理予定',
  'settings.danger.duplicates.meta.release': '解放見込み',
  'settings.danger.duplicates.meta.scanTime': 'スキャン時刻',
  'settings.danger.duplicates.meta.notScanned': '未スキャン',
  'settings.danger.duplicates.action.scan': '重複曲をスキャン',
  'settings.danger.duplicates.action.scanning': 'スキャン中...',
  'settings.danger.duplicates.action.clean': 'スキャン結果を整理',
  'settings.danger.duplicates.action.cleaning': '整理中...',
  'settings.danger.duplicates.progress.scan.title': '重複曲をスキャン中',
  'settings.danger.duplicates.progress.scan.description': '再生を圧迫しないよう分割処理しています',
  'settings.danger.duplicates.progress.scan.aria': '重複曲をスキャン中',
  'settings.danger.duplicates.progress.clean.title': 'スキャン結果を整理中',
  'settings.danger.duplicates.progress.clean.description': 'ごみ箱へ移動し、ライブラリ索引を更新しています',
  'settings.danger.duplicates.progress.clean.aria': '重複曲を整理中',
  'settings.danger.clearCache.title': 'ライブラリキャッシュを消去',
  'settings.danger.clearCache.description': 'ライブラリ索引、スキャン履歴、カバーキャッシュを削除します。音楽ファイルやライブラリフォルダーは削除しません。',
};

const enUS: TranslationMap = {
  ...zhCN,
  'albumTagEditor.action.applyToForm': 'Apply to form',
  'albumTagEditor.action.cancel': 'Cancel',
  'albumTagEditor.action.chooseCover': 'Choose cover',
  'albumTagEditor.action.close': 'Close tag editor',
  'albumTagEditor.action.deleteAlbum': 'Delete album',
  'albumTagEditor.action.loadEmbedded': 'Reload embedded tags',
  'albumTagEditor.action.loading': 'Loading',
  'albumTagEditor.action.loadNetwork': 'Load from network',
  'albumTagEditor.action.openInExplorer': 'Open in Explorer',
  'albumTagEditor.action.saveTags': 'Save tags',
  'albumTagEditor.action.saving': 'Saving',
  'albumTagEditor.action.searchCandidates': 'Search candidates',
  'albumTagEditor.action.searching': 'Searching',
  'albumTagEditor.albumSummary': '{count} tracks / {duration}',
  'albumTagEditor.cover.embeddedSuffix': ' / cover reloaded from embedded tags',
  'albumTagEditor.cover.localSuffix': ' / local cover: {path}',
  'albumTagEditor.cover.networkSuffix': ' / network cover will download and write on save',
  'albumTagEditor.currentAlbum': 'Current album',
  'albumTagEditor.currentAlbumAria': 'Current album',
  'albumTagEditor.discard.continue': 'Keep editing',
  'albumTagEditor.discard.discard': 'Discard changes',
  'albumTagEditor.discard.prompt': 'You have unsaved changes. Close and discard them?',
  'albumTagEditor.duration.hoursMinutes': '{hours} hr {minutes} min',
  'albumTagEditor.duration.minutes': '{minutes} min',
  'albumTagEditor.duration.unknown': 'Unknown length',
  'albumTagEditor.error.chooseCoverUnsupported': 'The current runtime cannot choose covers.',
  'albumTagEditor.error.embeddedUnsupported': 'The current runtime cannot read embedded tags.',
  'albumTagEditor.error.fixYearBeforeSave': 'Fix the year before saving tags.',
  'albumTagEditor.error.networkTemporary': 'Network sources are temporarily unavailable. Try again later.',
  'albumTagEditor.error.networkUnsupported': 'The current runtime cannot search network tags.',
  'albumTagEditor.error.noReadableTrack': 'This album has no track that can be used to read tags.',
  'albumTagEditor.error.openFolderUnsupported': 'The current runtime cannot open Explorer.',
  'albumTagEditor.error.positiveInteger': '{label} must be a positive integer or empty',
  'albumTagEditor.error.readTracksUnsupported': 'The current runtime cannot read album tracks.',
  'albumTagEditor.field.album': 'Album',
  'albumTagEditor.field.albumArtist': 'Album artist',
  'albumTagEditor.field.cover': 'Cover',
  'albumTagEditor.field.genre': 'Genre',
  'albumTagEditor.field.year': 'Year',
  'albumTagEditor.message.appliedNetwork': 'Applied to the form. Save to write it to songs in this album.',
  'albumTagEditor.message.noNetworkTags': 'No suitable network tags found.',
  'albumTagEditor.message.searchingNetwork': 'Searching network tags...',
  'albumTagEditor.network.aria': 'Network candidate comparison',
  'albumTagEditor.network.column.candidate': 'Candidate',
  'albumTagEditor.network.column.current': 'Current',
  'albumTagEditor.network.column.field': 'Field',
  'albumTagEditor.network.selectAll': 'Select all',
  'albumTagEditor.network.selectFields': 'Choose fields to apply to the album',
  'albumTagEditor.network.title': 'Network candidates',
  'albumTagEditor.saveDescription': 'Saving writes embedded tags to every song in this album and syncs the library immediately.',
  'albumTagEditor.section.albumInfo': 'Album information',
  'albumTagEditor.section.albumInfoDescription': 'Writes in bulk to songs in this album',
  'albumTagEditor.subtitle.albumBatch': 'Album-level batch tags',
  'albumTagEditor.subtitle.unsaved': 'Unsaved changes',
  'albumTagEditor.title': 'Edit tags',
  'albumTagEditor.value.albumCandidate': 'Album candidate',
  'albumTagEditor.value.empty': 'Empty',
  'albumTagEditor.value.existingCover': 'Existing cover',
  'albumTagEditor.value.networkCover': 'Network cover',
  'albumTagEditor.value.unknownAlbum': 'Unknown album',
  'albumTagEditor.value.unknownArtist': 'Unknown artist',
  'firstRun.action.finish': 'Finish setup',
  'firstRun.action.next': 'Next',
  'firstRun.action.previous': 'Back',
  'firstRun.action.skip': 'Skip',
  'firstRun.action.skipWizard': 'Skip wizard',
  'firstRun.aria.steps': 'First-run steps',
  'firstRun.aria.summary': 'Current wizard selection summary',
  'firstRun.audio.asio.description': 'Requires an ASIO device and reliable driver.',
  'firstRun.audio.asio.hint': 'Pro',
  'firstRun.audio.asio.label': 'ASIO',
  'firstRun.audio.exclusive.description': 'Exclusive device access for stable external interfaces or HiFi tuning.',
  'firstRun.audio.exclusive.hint': 'Advanced',
  'firstRun.audio.exclusive.label': 'WASAPI Exclusive',
  'firstRun.audio.linuxShared.description': 'Use ECHO native output through the Linux audio stack.',
  'firstRun.audio.linuxShared.hint': 'Advanced',
  'firstRun.audio.linuxShared.label': 'Linux Shared',
  'firstRun.audio.shared.description': 'Everyday shared output through the advanced audio engine.',
  'firstRun.audio.shared.hint': 'Advanced',
  'firstRun.audio.shared.label': 'WASAPI Shared',
  'firstRun.audio.system.description': 'Most stable for regular headphones, Bluetooth, and computer speakers.',
  'firstRun.audio.system.hint': 'Recommended',
  'firstRun.audio.system.label': 'Standard Output (Recommended)',
  'firstRun.accounts.cookie.description': 'If the provider login window is unavailable, paste a Cookie manually, save it, then use Check to confirm the account state.',
  'firstRun.accounts.cookie.title': 'Fallback method',
  'firstRun.accounts.login.description': 'For NetEase, QQ Music, Bilibili, SoundCloud, and similar providers, use Log In And Sync first. ECHO saves only the needed credentials after login.',
  'firstRun.accounts.login.title': 'Use web login first',
  'firstRun.accounts.note': 'Streaming accounts are optional and do not affect local playback. ECHO only uses playable content that each provider actually returns.',
  'firstRun.accounts.open.description': 'After finishing, open Settings > Integrations > Account Login to manage streaming, MV, download, and lyrics accounts.',
  'firstRun.accounts.open.title': 'Where to open it',
  'firstRun.accounts.spotify.description': 'Spotify uses the official player/Connect path, requires Premium, and does not provide downloadable audio URLs.',
  'firstRun.accounts.spotify.title': 'Spotify note',
  'firstRun.cache.chooseLocation': 'Choose cache location',
  'firstRun.cache.useDefault': 'Use default',
  'firstRun.currentSelection': 'Current selection',
  'firstRun.defaultLocation': 'Default location',
  'firstRun.description': 'Review library, cache, scanning, output, appearance, and account entry points in order. Keep the recommended values when unsure.',
  'firstRun.error.desktopBridgeCache': 'Desktop bridge unavailable, so the cache location cannot be selected right now.',
  'firstRun.error.desktopBridgeMusicFolder': 'Desktop bridge unavailable, so the music folder cannot be selected right now.',
  'firstRun.error.desktopBridgeSave': 'Desktop bridge unavailable, so first-run settings cannot be saved right now.',
  'firstRun.library.chooseFolder': 'Choose folder',
  'firstRun.library.noneSelected': 'Nothing selected. You can add one later.',
  'firstRun.library.scanAfterFinish': 'Scan after finishing',
  'firstRun.message.saved': 'First-run settings saved.',
  'firstRun.scan.balanced.description': 'Recommended. Scan speed and background load stay balanced.',
  'firstRun.scan.balanced.hint': 'Default',
  'firstRun.scan.balanced.label': 'Balanced',
  'firstRun.scan.low.description': 'Less disruption during playback. Scanning will be slower.',
  'firstRun.scan.low.hint': 'While listening',
  'firstRun.scan.low.label': 'Low impact',
  'firstRun.scan.performance.description': 'Build the library as quickly as possible. Best while the computer is idle.',
  'firstRun.scan.performance.hint': 'Idle time',
  'firstRun.scan.performance.label': 'Fast',
  'firstRun.step.audio.description': 'Use standard output for regular headphones, Bluetooth, and speakers. Enable external interfaces, exclusive output, or ASIO only after the device is known stable.',
  'firstRun.step.audio.eyebrow': '4 / 7',
  'firstRun.step.audio.label': 'Output',
  'firstRun.step.audio.title': 'Choose audio output',
  'firstRun.step.appearance.description': 'Pick the overall light/dark mode and theme colors first. Light is best for daytime work; dark is best at night. Follow system is the safest default.',
  'firstRun.step.appearance.eyebrow': '5 / 7',
  'firstRun.step.appearance.label': 'Appearance',
  'firstRun.step.appearance.title': 'Choose theme and light/dark mode',
  'firstRun.step.accounts.description': 'Streaming accounts can be connected later. They affect online search, playlist sync, MV/lyrics matching, and some download features, not the local library.',
  'firstRun.step.accounts.eyebrow': '6 / 7',
  'firstRun.step.accounts.label': 'Accounts',
  'firstRun.step.accounts.title': 'Streaming account login',
  'firstRun.step.cache.description': 'Cover, lyrics, and MV caches use disk space. If the C drive is tight, choose another drive; this can be changed later.',
  'firstRun.step.cache.eyebrow': '2 / 7',
  'firstRun.step.cache.label': 'Cache',
  'firstRun.step.cache.title': 'Choose cache location',
  'firstRun.step.library.description': 'Choose a music root and ECHO will read tags, covers, durations, and lyric hints to build the library. Files are not moved or deleted.',
  'firstRun.step.library.eyebrow': '1 / 7',
  'firstRun.step.library.label': 'Music',
  'firstRun.step.library.title': 'Choose music folder',
  'firstRun.step.scan.description': 'The first scan can be busy. Use Balanced for daily setup, Low impact while listening, and Fast while the computer is idle.',
  'firstRun.step.scan.eyebrow': '3 / 7',
  'firstRun.step.scan.label': 'Scan',
  'firstRun.step.scan.title': 'Choose scan mode',
  'firstRun.step.summary.description': 'Finishing only saves these base settings. You can reopen this guide from Settings and connect accounts later.',
  'firstRun.step.summary.eyebrow': '7 / 7',
  'firstRun.step.summary.label': 'Confirm',
  'firstRun.step.summary.title': 'Confirm settings',
  'firstRun.summary.addLater': 'Add later',
  'firstRun.summary.accounts': 'Accounts',
  'firstRun.summary.accountsLater': 'Log in later from Settings > Integrations',
  'firstRun.summary.cache': 'Cache',
  'firstRun.summary.kicker': 'Summary',
  'firstRun.summary.music': 'Music',
  'firstRun.summary.noFileMove': 'Your music files will not be moved or deleted.',
  'firstRun.summary.output': 'Output',
  'firstRun.summary.readyDescription': 'Finish will save these settings. If a folder is selected and scanning is enabled, ECHO will start building the library index.',
  'firstRun.summary.readyTitle': 'Ready to start',
  'firstRun.summary.scan': 'Scan',
  'firstRun.summary.scanWithFolder': '{mode}, scan after finishing',
  'firstRun.summary.theme': 'Appearance',
  'firstRun.summary.themeValue': '{mode}, {preset}',
  'firstRun.theme.dark.description': 'Lowers brightness for night use, dark rooms, and OLED screens.',
  'firstRun.theme.dark.hint': 'Night',
  'firstRun.theme.light.description': 'Clearer text for daytime, office use, and screenshots.',
  'firstRun.theme.light.hint': 'Clean',
  'firstRun.theme.modeTitle': 'Light/dark mode',
  'firstRun.theme.presetTitle': 'Theme colors',
  'firstRun.theme.system.description': 'Follow Windows or system appearance automatically.',
  'firstRun.theme.system.hint': 'Easy',
  'firstRun.title': 'Welcome to ECHO Next',
  'downloads.action.addToQueue': 'Add to queue',
  'downloads.action.cancelJob': 'Cancel task',
  'downloads.action.changeFolder': 'Change folder',
  'downloads.action.checkTools': 'Check environment',
  'downloads.action.chooseFolder': 'Choose folder',
  'downloads.action.clearCompleted': 'Clear completed',
  'downloads.action.creating': 'Creating',
  'downloads.action.search': 'Search',
  'downloads.action.searching': 'Searching',
  'downloads.description': 'Search YouTube / Bilibili with bundled yt-dlp and download the best available audio only.',
  'downloads.empty.noResults.description': 'Try another keyword.',
  'downloads.empty.noResults.title': 'No search results',
  'downloads.empty.queue.description': 'Paste a link or download a search result to see real progress here.',
  'downloads.empty.queue.title': 'Queue is empty',
  'downloads.empty.searching.description': 'Querying {scope}.',
  'downloads.empty.searching.title': 'Searching',
  'downloads.error.cookieFallback': 'Could not read browser cookies. Search was retried automatically without signed-in state.',
  'downloads.error.ipcUnavailable': 'Download IPC is not exposed in the current runtime.',
  'downloads.error.operationFailed': 'Download operation failed',
  'downloads.folder.required': 'Choose a download folder',
  'downloads.job.imported': 'Imported to library',
  'downloads.job.savedTo': 'Saved to {path}',
  'downloads.job.waitingProgress': 'Waiting for progress',
  'downloads.message.clearedTerminal': 'Cleared completed, failed, and cancelled tasks.',
  'downloads.message.completed': 'Download complete: {title}',
  'downloads.message.queued': 'Added to download queue.',
  'downloads.message.resultQueued': 'Added to queue: {title}',
  'downloads.queue.title': 'Download queue',
  'downloads.search.aria': 'Search downloads',
  'downloads.search.downloadAudio': 'Download audio',
  'downloads.search.joined': 'Added to queue',
  'downloads.search.placeholder': 'Search songs, artists, or video titles',
  'downloads.search.providerErrorItem': '{provider}: {error}',
  'downloads.search.providerErrors': 'Some platform searches failed: {errors}',
  'downloads.search.scopeAria': 'Search platform',
  'downloads.search.title': 'Search downloads',
  'downloads.search.unknownUploader': 'Unknown uploader',
  'downloads.search.views': '{count} views',
  'downloads.search.viewsWan': '{count}0k views',
  'downloads.settings.audioStrategy': 'Audio strategy',
  'downloads.settings.bestAvailable': 'Best available quality',
  'downloads.settings.bindMvAfterImport': 'Bind source URL as MV after import',
  'downloads.settings.importToLibrary': 'Import to library when complete',
  'downloads.settings.outputDirectory': 'Download folder',
  'downloads.settings.title': 'Download settings',
  'downloads.status.bindingMv': 'Binding MV',
  'downloads.status.cancelled': 'Cancelled',
  'downloads.status.completed': 'Completed',
  'downloads.status.downloading': 'Downloading',
  'downloads.status.extractingAudio': 'Extracting audio',
  'downloads.status.failed': 'Failed',
  'downloads.status.importing': 'Importing to library',
  'downloads.status.probing': 'Parsing link',
  'downloads.status.queued': 'Queued',
  'downloads.title': 'Downloads',
  'downloads.tools.notBundled': 'Not bundled with app',
  'downloads.tools.notDetected': 'Not detected',
  'downloads.tools.title': 'Environment check',
  'downloads.url.placeholder': 'Paste a YouTube / Bilibili / SoundCloud / osu! link',
  'downloads.url.title': 'Paste link to download',
  'albumMenu.action.addToPlaylist': 'Add to playlist...',
  'albumMenu.action.addToQueue': 'Add to queue',
  'albumMenu.action.copyCover': 'Copy album cover',
  'albumMenu.action.copyInfo': 'Copy album info',
  'albumMenu.action.deleteAlbum': 'Delete album',
  'albumMenu.action.editTags': 'Edit tags',
  'albumMenu.action.likeAlbum': 'Like album',
  'albumMenu.action.playAlbum': 'Play album',
  'albumMenu.action.saveCover': 'Save album cover',
  'albumMenu.action.unlikeAlbum': 'Unlike album',
  'albumMenu.playlistSubmenu.aria': 'Choose playlist',
  'albumMenu.playlistSubmenu.empty': 'No local playlists',
  'albumMenu.playlistSubmenu.itemCount': '{count} tracks',
  'albumMenu.playlistSubmenu.loading': 'Loading playlists...',
  'accountProvider.kugou': 'KuGou Music',
  'accountProvider.netease': 'NetEase Cloud Music',
  'accountProvider.qqmusic': 'QQ Music',
  'accountProvider.unknown': 'Unknown account',
  'desktopLyrics.aria.stage': 'Desktop lyrics',
  'desktopLyrics.control.close': 'Close',
  'desktopLyrics.control.colorSwatch': 'Color {color}',
  'desktopLyrics.control.customColor': 'Custom color',
  'desktopLyrics.control.decreaseFontSize': 'Decrease font size',
  'desktopLyrics.control.decreaseScale': 'Scale down',
  'desktopLyrics.control.increaseFontSize': 'Increase font size',
  'desktopLyrics.control.increaseScale': 'Scale up',
  'desktopLyrics.control.lock': 'Lock',
  'desktopLyrics.control.resetPosition': 'Reset position',
  'desktopLyrics.control.romanization': 'Show romanization in desktop lyrics',
  'desktopLyrics.control.themeColor': 'Follow theme color',
  'desktopLyrics.control.translation': 'Show translation in desktop lyrics',
  'desktopLyrics.control.translationShort': 'T',
  'desktopLyrics.primary.empty': 'No lyrics',
  'desktopLyrics.primary.instrumental': 'Instrumental',
  'desktopLyrics.secondary.waiting': 'Waiting for playback',
  'lyricsView.empty.instrumental': 'Instrumental',
  'lyricsView.empty.noLyrics': 'No lyrics',
  'mvPanel.action.close': 'Close',
  'mvPanel.action.copied': 'Copied',
  'mvPanel.action.copy': 'Copy',
  'mvPanel.action.dismissUnavailable': 'Dismiss MV unavailable notice',
  'mvPanel.diagnostics.title': 'MV Diagnostics Report',
  'mvPanel.notice.unavailable': 'MV unavailable',
  'mvPanel.status.bilibiliBlocked': 'Bilibili temporarily rejected playback parsing. Try again later or open externally',
  'mvPanel.status.databaseUnread': 'MV database is unreadable',
  'mvPanel.status.externalRequired': 'This MV requires external playback',
  'mvPanel.status.inAppUnavailable': 'This MV cannot play inside the app',
  'mvPanel.status.loadFailed': 'MV failed to load',
  'mvPanel.status.loading': 'Loading MV',
  'mvPanel.status.localUnsupported': 'Local video format is not supported',
  'mvPanel.status.missingUrl': 'Missing playable URL',
  'mvPanel.status.networkFailed': 'Network MV request failed',
  'mvPanel.status.notFound': 'No playable MV found',
  'mvPanel.status.temporaryPlayback': 'Temporary MV playing; database still needs repair',
  'mvPanel.status.unavailable': 'MV unavailable',
  'mvPanel.status.videoFailed': 'Video failed to load',
  'miniPlayer.action.close': 'Close mini player',
  'miniPlayer.action.closeQueue': 'Close playback queue',
  'miniPlayer.action.closeShort': 'Close',
  'miniPlayer.action.next': 'Next track',
  'miniPlayer.action.openQueue': 'Open playback queue',
  'miniPlayer.action.pause': 'Pause',
  'miniPlayer.action.play': 'Play',
  'miniPlayer.action.previous': 'Previous track',
  'miniPlayer.action.resetPosition': 'Reset position',
  'miniPlayer.action.volume': 'Adjust volume',
  'miniPlayer.aria.progress': 'Playback progress',
  'miniPlayer.aria.queue': 'Playback queue',
  'miniPlayer.aria.shell': 'Mini player',
  'miniPlayer.aria.volume': 'Volume',
  'miniPlayer.artist.unknown': 'Unknown Artist',
  'miniPlayer.status.hqPlayerTakeover': 'HQPlayer takeover active',
  'miniPlayer.status.queueEmpty': 'Queue is empty',
  'miniPlayer.status.ready': 'Ready',
  'playerStatus.audioSpecifications': 'Audio specifications',
  'playerStatus.ready': 'Ready',
  'playerStatus.streaming': 'Streaming',
  'playerSpeed.label': 'Playback speed',
  'playerSpeed.reset': 'Reset playback speed',
  'playerVolume.fixed.disable': 'Disable fixed volume',
  'playerVolume.fixed.enable': 'Enable fixed volume',
  'playerVolume.fixed.enabled': 'Fixed volume enabled',
  'playerVolume.fixed.dsdAutoLocked': 'Volume auto-locked during DSD playback',
  'playerVolume.fixed.title': 'Fixed volume',
  'import.dragDrop.desktopBridgeUnavailable': 'Desktop bridge unavailable. Import dropped files in ECHO Next desktop.',
  'import.dragDrop.files.empty': 'No importable audio files found.',
  'import.dragDrop.files.failed': '{count} files failed to import',
  'import.dragDrop.files.ignored': 'Ignored {count} unsupported files',
  'import.dragDrop.files.imported': 'Imported {count} songs',
  'import.dragDrop.files.summaryWithOutput': '{summary}. Files were saved to: {outputDirectory}',
  'import.dragDrop.noDroppedFiles': 'No dropped files were read.',
  'import.dragDrop.overlay.description': 'Files are saved to Downloads and added to the library',
  'import.dragDrop.overlay.title': 'Drop music or osu! beatmaps to import into your library',
  'import.dragDrop.paths.addedFolders': 'Added {count} folders',
  'import.dragDrop.paths.empty': 'No importable music files or folders found',
  'import.dragDrop.paths.failed': '{count} paths failed to import',
  'import.dragDrop.paths.ignored': 'Ignored {count} unsupported files',
  'import.dragDrop.paths.importedFiles': 'Imported {count} files',
  'import.dragDrop.paths.missing': 'Skipped {count} inaccessible paths',
  'import.dragDrop.paths.scannedAudioFolders': 'Scanned {count} folders containing music files',
  'notice.accountExpired': 'Account login may have expired: {names}. Go to Settings > Integrations to sign in again.',
  'notice.accountExpired.title': 'Account Login Expired',
  'notice.action.close': 'Close',
  'notice.action.closeNotice': 'Close notice',
  'notice.action.ignore': 'Ignore',
  'notice.action.openReport': 'Open Report',
  'notice.audioError.description': 'A Markdown diagnostics report was generated with detailed causes and troubleshooting clues.',
  'notice.audioError.title': 'Audio Error',
  'notice.audioDefaultFormatWarning': 'Audio settings reminder: the Windows default format looks too high at {rate}. ECHO will only warn you and will not change system settings; 48 kHz is recommended.',
  'notice.diagnosticsCrash.description': 'ECHO Next did not exit normally last time. A Markdown report is ready for troubleshooting.',
  'notice.importFiles.empty': 'No audio files can be imported.',
  'notice.importFiles.failed': '{count} files failed to import',
  'notice.importFiles.imported': 'Imported {count} files into the library',
  'notice.importFiles.skipped': 'Skipped {count} unsupported or unavailable files',
  'notice.openFiles.partial': 'Opened {opened} files and skipped {rejected} unsupported or unavailable files.',
  'notice.reportOpened': 'Markdown report opened.',
  'notice.reportOpenedPath': 'Markdown report opened: {path}',
  'notice.updateAvailable': 'A new ECHO NEXT version is available.',
  'notice.updateAvailableVersion': 'A new ECHO NEXT version {version} is available.',
  'notice.updateDownloaded': 'ECHO NEXT update has been downloaded and is ready to install.',
  'notice.updateDownloadedVersion': 'ECHO NEXT {version} has been downloaded and is ready to install.',
  'punctuation.clauseSeparator': ', ',
  'punctuation.listSeparator': ', ',
  'library.action.refresh': 'Refresh',
  'library.albums.card.tracks': '{count} tracks',
  'library.albums.confirm.deleteAlbumFiles': 'Delete album files?\n{title}\n\nThis will move {count} tracks to the system recycle bin and remove them from the media library.',
  'library.albums.error.coverNotSaved': 'Album cover was not saved.',
  'library.albums.error.desktopBridge': 'Desktop bridge unavailable. Open ECHO Next in Electron to read albums.',
  'library.albums.error.noCopyableCover': 'This album has no copyable cover.',
  'library.albums.error.noPlayableTracks': 'This album has no playable tracks.',
  'library.albums.error.remoteEditUnsupported': 'Remote albums do not support tag editing or deleting server files yet.',
  'library.albums.listAria': 'Album list',
  'library.albums.loading': 'Loading albums...',
  'library.albums.searchPlaceholder': 'Search albums / artists',
  'library.albums.sort.aria': 'Album sort',
  'library.albums.sort.artist': 'Artist',
  'library.albums.sort.titleAsc': 'Title A-Z',
  'library.albums.sort.titleDesc': 'Title Z-A',
  'library.albums.title': 'Albums',
  'libraryDiagnostics.lab.description': 'These tools are for development testing of live media-library behavior. They are off by default and do not affect regular users. Use them only on test branches or test libraries.',
  'library.artists.error.desktopBridge': 'Desktop bridge unavailable. Open ECHO Next in Electron to read artists.',
  'library.artists.avatarPriority': 'Avatar First',
  'library.artists.listAria': 'Artist list',
  'library.artists.loading': 'Loading artists...',
  'library.artists.meta.albums': '{count} albums',
  'library.artists.meta.noTracks': 'No tracks',
  'library.artists.meta.tracks': '{count} tracks',
  'library.artists.searchPlaceholder': 'Search artists',
  'library.artists.sort.aria': 'Artist sort',
  'library.artists.sort.frequent': 'Most Tracks',
  'library.artists.sort.nameAsc': 'Name A-Z',
  'library.artists.sort.nameDesc': 'Name Z-A',
  'library.artists.title': 'Artists',
  'artistDetail.action.addToQueue': 'Add to Queue',
  'artistDetail.action.back': 'Artists',
  'artistDetail.action.playArtist': 'Play Artist',
  'artistDetail.action.readingArtist': 'Reading Artist',
  'artistDetail.action.refreshInfo': 'Refresh Info',
  'artistDetail.action.shuffle': 'Shuffle',
  'artistDetail.albums.aria': '{artist} albums',
  'artistDetail.albums.count': '{count} albums',
  'artistDetail.albums.empty': 'No albums are grouped under this artist yet.',
  'artistDetail.albums.error.desktopBridge': 'Desktop bridge unavailable. Open ECHO Next in Electron to read artist albums.',
  'artistDetail.albums.heading': 'Albums by {artist}',
  'artistDetail.albums.loadedCount': '{loaded} of {total} albums',
  'artistDetail.aroundWeb.aria': 'Artist official and social links',
  'artistDetail.aroundWeb.heading': 'Around the web',
  'artistDetail.aria.details': '{artist} artist details',
  'artistDetail.aria.events': 'Artist events',
  'artistDetail.aria.facts': 'Artist facts',
  'artistDetail.aria.metadata': 'Artist metadata',
  'artistDetail.aria.onlineSources': 'Online artist sources',
  'artistDetail.aria.overview': 'Artist overview',
  'artistDetail.aria.relationshipMap': 'Artist relationship map',
  'artistDetail.aria.sections': '{artist} detail sections',
  'artistDetail.duration.hours': '{hours} hr {minutes} min loaded',
  'artistDetail.duration.minutes': '{minutes} min loaded',
  'artistDetail.duration.reading': 'Reading length',
  'artistDetail.empty.relationships': 'No local 1-hop relationships found yet.',
  'artistDetail.error.desktopBridgeRead': 'Desktop bridge unavailable. Open ECHO Next in Electron to read this artist.',
  'artistDetail.events.configureProviders': 'Concert info needs Bandsintown, Ticketmaster, or SeatGeek keys. Without keys, ECHO will not load real concert data.',
  'artistDetail.events.collapse': 'Collapse',
  'artistDetail.events.collapsedHint': '{count} concerts found. Expand to view dates, venues, and ticket links.',
  'artistDetail.events.count': '{count} concerts',
  'artistDetail.events.expand': 'Expand',
  'artistDetail.events.noConcerts': 'No upcoming concerts matched.',
  'artistDetail.events.noConcertsRegion': 'No upcoming concerts matched {region}.',
  'artistDetail.events.providerKeysRequired': 'Provider keys required',
  'artistDetail.events.venuePending': 'Venue to be announced',
  'artistDetail.fact.albums': 'Albums',
  'artistDetail.fact.loaded': 'Loaded',
  'artistDetail.fact.sources': 'Sources',
  'artistDetail.fact.tracks': 'Tracks',
  'artistDetail.label.artist': 'Artist',
  'artistDetail.label.overview': 'Overview',
  'artistDetail.meta.albums': '{count} albums',
  'artistDetail.meta.loadedTracks': '{loaded}/{total} loaded',
  'artistDetail.meta.tracks': '{count} tracks',
  'artistDetail.missing.description': 'Return to Artists and refresh the library to see the latest catalog.',
  'artistDetail.missing.title': 'Artist does not exist or has been removed from the library.',
  'artistDetail.overview.about': 'About {artist}',
  'artistDetail.overview.bioFallback': 'Collected from your local library. Online artist information loads quietly in the background.',
  'artistDetail.relation.bpm': 'BPM',
  'artistDetail.relation.collaboration': 'Collaboration',
  'artistDetail.relation.evidence': '{label} / {evidence}',
  'artistDetail.relation.genre': 'Genre',
  'artistDetail.relation.history': 'History',
  'artistDetail.relation.link': 'Link',
  'artistDetail.relation.local': 'Local library signal',
  'artistDetail.relation.member': 'Member',
  'artistDetail.relation.sameAlbum': 'Same album',
  'artistDetail.relation.similar': 'Similar',
  'artistDetail.section.concertInfo': 'Concert information',
  'artistDetail.section.events': 'Events',
  'artistDetail.section.localNetwork': 'Local network',
  'artistDetail.section.relationshipMap': 'Relationship Map',
  'artistDetail.status.collectedLocally': 'Collected locally',
  'artistDetail.status.linkedArtists': '{count} linked artists',
  'artistDetail.status.loadingSignals': 'Loading local signals',
  'artistDetail.status.localLibrary': 'Local library',
  'artistDetail.status.readingRelationships': 'Reading artist relationships...',
  'artistDetail.status.readySoon': 'Ready soon',
  'artistDetail.tab.albums': 'Albums',
  'artistDetail.tab.overview': 'Overview',
  'artistDetail.tab.songs': 'Songs',
  'artistDetail.tracks.action.addToQueueAria': 'Add {title} to queue',
  'artistDetail.tracks.action.more': 'More',
  'artistDetail.tracks.action.moreAria': 'More actions for {title}',
  'artistDetail.tracks.action.playNext': 'Play next',
  'artistDetail.tracks.action.playNextAria': 'Play {title} next',
  'artistDetail.tracks.aria': 'Songs by {artist}',
  'artistDetail.tracks.column.actions': 'Actions',
  'artistDetail.tracks.column.album': 'Album',
  'artistDetail.tracks.column.signal': 'Signal',
  'artistDetail.tracks.column.time': 'Time',
  'artistDetail.tracks.column.title': 'Title',
  'artistDetail.tracks.confirm.delete': 'Delete the music file?\n{title}',
  'artistDetail.tracks.empty': 'No songs are grouped under this artist yet.',
  'artistDetail.tracks.error.actionUnavailable': 'This track action is not available yet.',
  'artistDetail.tracks.error.desktopBridgeActions': 'Desktop bridge unavailable. Open ECHO Next in Electron to use file actions.',
  'artistDetail.tracks.error.desktopBridgeEdit': 'Desktop bridge unavailable. Open ECHO Next in Electron to edit embedded tags.',
  'artistDetail.tracks.error.desktopBridgeRead': 'Desktop bridge unavailable. Open ECHO Next in Electron to read artist tracks.',
  'artistDetail.tracks.expandAll': 'Expand all',
  'artistDetail.tracks.error.noCoverSaved': 'No cover art was saved for this track.',
  'artistDetail.tracks.error.noCoverToCopy': 'This track does not have cover art to copy.',
  'artistDetail.tracks.error.remoteFileAction': 'Remote tracks do not support local file actions yet.',
  'artistDetail.tracks.formatAria': 'Track format',
  'artistDetail.tracks.heading': 'Songs by {artist}',
  'artistDetail.tracks.loadedCount': '{loaded} of {total} tracks',
  'artistDetail.tracks.loading': 'Loading songs...',
  'artistDetail.tracks.loadingTrack': 'Loading track',
  'artistDetail.tracks.status.addedToPlaylist': 'Added to playlist: {playlist}',
  'artistDetail.tracks.status.albumNotFound': 'Album not found in this artist view: {album}',
  'artistDetail.tracks.status.notInQueue': 'This song is not in the queue: {title}',
  'artistDetail.tracks.status.reloadedTags': 'Reloaded embedded tags: {title}',
  'artistDetail.tracks.status.removedFromQueue': 'Removed from queue: {title}',
  'artistDetail.tracks.unknownAlbum': 'Unknown Album',
  'library.count.total': '{count} total',
  'library.sort.createdAsc': 'Created Oldest',
  'library.sort.createdDesc': 'Created Newest',
  'library.sort.default': 'Default',
  'library.sort.durationAsc': 'Duration Shortest',
  'library.sort.durationDesc': 'Duration Longest',
  'library.sort.fileModifiedAsc': 'File Modified Oldest',
  'library.sort.fileModifiedDesc': 'File Modified Newest',
  'library.sort.random': 'Random',
  'library.sort.recent': 'Recent',
  'library.source.aria': 'Library source',
  'library.source.local': 'Local',
  'library.source.allRemote': 'All cloud sources',
  'library.source.remote': 'Cloud',
  'library.trackRow.action.addToPlaylist': 'Add to playlist',
  'library.trackRow.action.addToPlaylistLabel': 'Add {title} to playlist',
  'library.trackRow.action.addToQueue': 'Add to queue',
  'library.trackRow.action.addToQueueLabel': 'Add {title} to queue',
  'library.trackRow.action.download': 'Download',
  'library.trackRow.action.downloadLabel': 'Download {title}',
  'library.trackRow.action.downloading': 'Downloading {percent}%',
  'library.trackRow.action.downloadingLabel': 'Downloading {title} {percent}%',
  'library.trackRow.action.more': 'More',
  'library.trackRow.action.moreLabel': 'More actions for {title}',
  'library.trackRow.actions': '{title} actions',
  'library.trackRow.audioSpecifications': 'Audio specifications',
  'library.trackRow.duplicateVersions.count': '{count} versions',
  'library.trackRow.duplicateVersions.title': 'View duplicate song versions',
  'library.trackRow.openAlbum': 'Open album: {album}',
  'library.trackRow.openArtist': 'Open artist: {artist}',
  'library.trackRow.status.playing': 'Playing',
  'library.trackRow.status.unavailable': 'Unavailable',
  'app.navigation.main': 'Main navigation',
  'app.navigation.utility': 'Utility navigation',
  'app.toolbar.quickActions': 'Quick actions',
  'app.toolbar.windowControls': 'Window controls',
  'app.window.minimize': 'Minimize',
  'app.window.maximize': 'Maximize',
  'app.window.restore': 'Restore',
  'app.window.fullscreen': 'Fullscreen',
  'app.window.exitFullscreen': 'Exit fullscreen',
  'app.window.close': 'Close',
  'albumDetail.action.addToQueue': 'Add to queue',
  'albumDetail.action.back': 'Albums',
  'albumDetail.action.likeAlbum': 'Like album',
  'albumDetail.action.more': 'More album actions',
  'albumDetail.action.openSource': 'Open source',
  'albumDetail.action.playNow': 'Play Now',
  'albumDetail.action.readingAlbum': 'Reading album',
  'albumDetail.action.refresh': 'Refresh',
  'albumDetail.action.showInFolder': 'Show in folder',
  'albumDetail.action.unlikeAlbum': 'Unlike album',
  'albumDetail.aria.details': '{album} album details',
  'albumDetail.aria.info': 'Album info',
  'albumDetail.aria.metadata': 'Album metadata',
  'albumDetail.aria.openArtist': 'Open artist {artist}',
  'albumDetail.aria.sections': 'Album sections',
  'albumDetail.aria.trackConsole': '{album} track console',
  'albumDetail.artist.notFound': 'Artist not found: {artist}',
  'albumDetail.count.albums': '{count} albums',
  'albumDetail.count.loadedAlbums': '{loaded} of {total} albums',
  'albumDetail.count.loadedTracks': '{loaded} of {total} tracks',
  'albumDetail.count.tracks': '{count} tracks',
  'albumDetail.credit.role.arrangement': 'Arrangement',
  'albumDetail.credit.role.composer': 'Composition',
  'albumDetail.credit.role.engineering': 'Engineering',
  'albumDetail.credit.role.label': 'Release & label',
  'albumDetail.credit.role.lyrics': 'Lyrics & words',
  'albumDetail.credit.role.other': 'Other credits',
  'albumDetail.credit.role.performer': 'Performance',
  'albumDetail.credit.role.production': 'Production',
  'albumDetail.credit.role.vocal': 'Vocal & voices',
  'albumDetail.credit.source.album': 'album credit',
  'albumDetail.credit.source.label': 'label',
  'albumDetail.credit.source.recording': 'track credit',
  'albumDetail.credit.source.work': 'work credit',
  'albumDetail.credit.summary.arrangement': 'Arrangement, orchestration, and adaptation credits.',
  'albumDetail.credit.summary.composer': 'Music-writing credits from release, recording, or work relationships.',
  'albumDetail.credit.summary.engineering': 'Recording, mix, mastering, and sound engineering credits.',
  'albumDetail.credit.summary.label': 'Label and catalog information tied to the release.',
  'albumDetail.credit.summary.lyrics': 'Lyric, words, libretto, and related writing credits.',
  'albumDetail.credit.summary.other': 'Additional credits found in the online metadata match.',
  'albumDetail.credit.summary.performer': 'Instrumental and performance credits attached to the release or individual recordings.',
  'albumDetail.credit.summary.production': 'Producer and production-side credits.',
  'albumDetail.credit.summary.vocal': 'Lead vocals, featured voices, and credited vocal roles.',
  'albumDetail.credits.count': '{count} credited people and organizations',
  'albumDetail.credits.entries': '{count} entries',
  'albumDetail.credits.heading': 'Album credits',
  'albumDetail.credits.overviewAria': 'Credit overview',
  'albumDetail.credits.trackPrefix': 'Track: {title}',
  'albumDetail.duration.hours': '{hours} hr {minutes} min',
  'albumDetail.duration.minutes': '{minutes} min',
  'albumDetail.fact.format': 'Format',
  'albumDetail.fact.genre': 'Genre',
  'albumDetail.fact.library': 'Library',
  'albumDetail.fact.released': 'Released',
  'albumDetail.information.albumProfile': 'Album profile',
  'albumDetail.information.artistProfile': 'Artist profile',
  'albumDetail.information.atGlance': 'At a glance',
  'albumDetail.information.externalLinks': 'External links',
  'albumDetail.information.overviewAria': 'Album and artist overview',
  'albumDetail.label.album': 'Album',
  'albumDetail.online.emptyDescription': 'MusicBrainz and Wikipedia did not return enough matching data for this album.',
  'albumDetail.online.emptyTitle': 'No reliable online info found',
  'albumDetail.online.match': 'MusicBrainz match',
  'albumDetail.online.noSource': 'No source matched',
  'albumDetail.online.possibleMatch': 'Possible MusicBrainz match',
  'albumDetail.online.reading': 'Reading online album info...',
  'albumDetail.online.sources': 'Online sources',
  'albumDetail.online.unavailable': 'Online info unavailable',
  'albumDetail.ratings.count': '{count} ratings',
  'albumDetail.ratings.overviewAria': 'External album ratings',
  'albumDetail.releases.count': '{count} release versions',
  'albumDetail.releases.current': 'Current match',
  'albumDetail.releases.currentHint': 'Shows the MusicBrainz release matched to this local album',
  'albumDetail.releases.heading': 'Versions / Releases',
  'albumDetail.releases.overviewAria': 'Album release version overview',
  'albumDetail.related.aria': '{artist} albums in your library',
  'albumDetail.related.heading': 'My Library',
  'albumDetail.related.loading': 'Loading albums',
  'albumDetail.related.thisAlbum': 'This album',
  'albumDetail.sources.barcode': 'Barcode',
  'albumDetail.sources.catalogNumber': 'Catalog no.',
  'albumDetail.sources.copyright': 'Copyright',
  'albumDetail.sources.kind.database': 'Database',
  'albumDetail.sources.kind.official': 'Official',
  'albumDetail.sources.kind.other': 'Web',
  'albumDetail.sources.kind.reference': 'Reference',
  'albumDetail.sources.kind.streaming': 'Streaming',
  'albumDetail.sources.labels': 'Label / catalog',
  'albumDetail.sources.linksAria': 'Album external source links',
  'albumDetail.sources.releaseAria': 'Current matched release info',
  'albumDetail.sources.releaseDetails': 'Current release',
  'albumDetail.status.addedToQueue': 'Added {count} tracks to queue.',
  'albumDetail.status.copiedCover': 'Original cover copied',
  'albumDetail.status.libraryReady': '{value} ready',
  'albumDetail.status.readingSignal': 'Reading signal',
  'albumDetail.status.unknownGenre': 'Unknown genre',
  'albumDetail.status.unknownLength': 'Unknown length',
  'albumDetail.status.unknownYear': 'Unknown year',
  'albumDetail.tab.credits': 'Credits',
  'albumDetail.tab.information': 'Information',
  'albumDetail.tab.releases': 'Versions',
  'albumDetail.tab.sources': 'Sources',
  'albumDetail.tab.tracks': 'Tracks',
  'albumDetail.texture.discs': '{count} discs',
  'albumDetail.tracks.action.like': 'Like {title}',
  'albumDetail.tracks.action.likeTitle': 'Like',
  'albumDetail.tracks.action.unlike': 'Unlike {title}',
  'albumDetail.tracks.action.unlikeTitle': 'Unlike',
  'albumDetail.tracks.aria': 'Album tracks',
  'albumDetail.tracks.column.signal': 'Signal',
  'albumDetail.tracks.column.time': 'Time',
  'albumDetail.tracks.column.title': 'Title',
  'albumDetail.tracks.confirm.delete': 'Delete the music file?\n{title}',
  'albumDetail.tracks.empty': 'No tracks found for this album.',
  'albumDetail.tracks.error.actionUnavailable': 'This track action is not available yet.',
  'albumDetail.tracks.error.desktopBridgeActions': 'Desktop bridge unavailable. Open ECHO Next in Electron to use file actions.',
  'albumDetail.tracks.error.desktopBridgeEdit': 'Desktop bridge unavailable. Open ECHO Next in Electron to edit embedded tags.',
  'albumDetail.tracks.error.desktopBridgeRead': 'Desktop bridge unavailable. Open ECHO Next in Electron to read album tracks.',
  'albumDetail.tracks.error.noCoverSaved': 'No cover art was saved for this track.',
  'albumDetail.tracks.error.noCoverToCopy': 'This track does not have cover art to copy.',
  'albumDetail.tracks.error.remoteFileAction': 'Remote tracks do not support local file actions yet.',
  'albumDetail.tracks.formatAria': 'Track format',
  'albumDetail.tracks.loadMore': 'Load more',
  'albumDetail.tracks.loading': 'Loading...',
  'albumDetail.tracks.status.addedToPlaylist': 'Added to playlist: {playlist}',
  'albumDetail.tracks.status.albumNotFound': 'Already viewing this album: {title}',
  'albumDetail.tracks.status.notInQueue': 'This track is not in the queue: {title}',
  'albumDetail.tracks.status.reloadedTags': 'Reloaded embedded tags: {title}',
  'albumDetail.tracks.status.removedFromQueue': 'Removed from queue: {title}',
  'albumDetail.tracks.summaryAria': 'Track summary',
  'audioDrawer.action.close': 'Close audio settings',
  'audioDrawer.action.copiedDiagnostics': 'Playback diagnostics copied',
  'audioDrawer.action.copyDiagnostics': 'Copy Playback Diagnostics',
  'audioDrawer.action.hideDevice': 'Hide device',
  'audioDrawer.action.openAsioPanel': 'Open ASIO Panel',
  'audioDrawer.action.resetEngine': 'Reset Audio Engine',
  'audioDrawer.action.resetEngineBusy': 'Resetting Audio Engine',
  'audioDrawer.action.resetEngineDone': 'Audio engine reset',
  'audioDrawer.action.restore': 'Restore',
  'audioDrawer.asioLatency.description': 'Estimated extra wait before the output plays from the buffer that actually opened. Lower feels faster; higher is safer against crackles.',
  'audioDrawer.asioLatency.recommended': 'Recommended latency',
  'audioDrawer.asioLatency.status': 'Requested {requested} frames / opened {opened} frames',
  'audioDrawer.asioLatency.value': '{value} ms',
  'audioDrawer.asioRoutes.title': 'ASIO output channels',
  'audioDrawer.badge.bitPerfectReady': 'Bit-perfect ready',
  'audioDrawer.badge.dspActive': 'DSP active',
  'audioDrawer.badge.juceFallback': 'JUCE fallback',
  'audioDrawer.badge.juceOutput': 'JUCE output',
  'audioDrawer.badge.resampling': 'Resampling',
  'audioDrawer.badge.soxrResampler': 'SOXR',
  'audioDrawer.badge.speedUp': 'Speed Up',
  'audioDrawer.buffer.asio': 'ASIO buffer',
  'audioDrawer.buffer.auto': 'Auto',
  'audioDrawer.buffer.collapsedDescription': 'Collapsed by default; open to adjust latency profile and ASIO buffer options.',
  'audioDrawer.buffer.default': 'Default',
  'audioDrawer.buffer.latencyProfile': 'Latency profile',
  'audioDrawer.buffer.low': 'Low',
  'audioDrawer.buffer.profileDefault': 'Profile default',
  'audioDrawer.buffer.safer': 'Safer',
  'audioDrawer.buffer.stable': 'Stable',
  'audioDrawer.buffer.title': 'Buffer Settings',
  'audioDrawer.buffer.ultraLow': 'Ultra low',
  'audioDrawer.device.asioDriver': 'ASIO driver',
  'audioDrawer.device.lowLatency': 'Low latency',
  'audioDrawer.device.selected': 'Selected',
  'audioDrawer.device.systemAudio': 'Windows Direct Output',
  'audioDrawer.device.systemAudioDescription': 'Default Windows audio path for headphones, Bluetooth, and computer speakers',
  'audioDrawer.device.systemDefault': 'System default',
  'audioDrawer.device.systemDefaultOutput': 'System default output',
  'audioDrawer.device.systemOutput': 'System output',
  'audioDrawer.device.systemSelectedRoute': 'System selected route',
  'audioDrawer.empty.asioDevices': 'No ASIO output devices found.',
  'audioDrawer.empty.hiddenDevices': 'No hidden devices.',
  'audioDrawer.empty.systemDevices': 'No system output devices found.',
  'audioDrawer.error.desktopBridgeUnavailable': 'Desktop bridge unavailable',
  'audioDrawer.meter.direct': 'Direct',
  'audioDrawer.meter.chain': 'Chain',
  'audioDrawer.meter.mode': 'Mode',
  'audioDrawer.meter.output': 'Output',
  'audioDrawer.meter.rate': 'Rate',
  'audioDrawer.meter.resample': 'Resample',
  'audioDrawer.meter.source': 'Source',
  'audioDrawer.meter.latency': 'Latency',
  'audioDrawer.guard.asioUnavailable.description': 'Default off. Skips the same ASIO device briefly after No device found, then uses safe shared output.',
  'audioDrawer.guard.asioUnavailable.title': 'ASIO unavailable guard',
  'audioDrawer.guard.exclusiveInstability.description': 'Default off. If WASAPI Exclusive has sustained underruns or becomes unstable, switch from the current position to safe Shared output.',
  'audioDrawer.guard.exclusiveInstability.title': 'Auto-switch unstable Exclusive',
  'audioDrawer.guard.soxrFallback.description': 'Default on. Shared SOXR resampling falls back to FFmpeg default if SOXR is unavailable before PCM starts.',
  'audioDrawer.guard.soxrFallback.title': 'SOXR fallback guard',
  'audioDrawer.latency.balanced': 'Balanced',
  'audioDrawer.latency.balancedDetail': '2048 frames',
  'audioDrawer.latency.lowLatency': 'Low latency',
  'audioDrawer.latency.lowLatencyDetail': '1024 frames / stable fallback',
  'audioDrawer.latency.stable': 'Stable',
  'audioDrawer.latency.stableDetail': '8192 frames',
  'audioDrawer.mode.exclusive': 'Exclusive',
  'audioDrawer.mode.exclusiveCandidate': 'Exclusive candidate',
  'audioDrawer.mode.directSound': 'DirectSound Compatibility',
  'audioDrawer.mode.shared': 'Shared',
  'audioDrawer.note.asio': 'Low-latency professional audio interface support requires a driver.',
  'audioDrawer.note.currentOutput': 'This shows the output path in use. Shared is for daily listening; ASIO and WASAPI Exclusive are highlighted in gold.',
  'audioDrawer.note.engine': 'Quickly check the output device, mode, sample rate, EQ, and resampling state.',
  'audioDrawer.note.juceOutput': 'Off by default. The FFmpeg compatibility path is the default output; enable JUCE output manually when needed, with automatic fallback on failure.',
  'audioDrawer.note.juceDecode': 'Off by default. When enabled, uses resident native decode for local WAV/FLAC/MP3 files that need no resampling; MP3 uses Windows Media and falls back to FFmpeg on failure.',
  'audioDrawer.note.dsdDop': 'Off by default. Tries DoP direct output for local DSF in Exclusive or ASIO; falls back to FFmpeg PCM on failure. Trust the DAC display.',
  'audioDrawer.note.asioNativeDsd': 'Off by default. Tries only for ASIO + local DSF + DoP with no EQ, volume, speed, or DSP; falls back to the existing DoP/PCM path on failure.',
  'audioDrawer.note.dsdAutoVolumeLock': 'Off by default. When enabled, ECHO volume is temporarily locked to 100% during DSD playback and restored when playback returns to PCM.',
  'audioDrawer.note.releaseExclusiveOnPause': 'Experimental. Pause releases WASAPI Exclusive so other apps can play; resume tries Exclusive again and temporarily falls back to Shared if needed.',
  'audioDrawer.option.juceOutput': 'JUCE Main Output',
  'audioDrawer.option.juceDecode': 'Resident Native Decode',
  'audioDrawer.option.dsdDop': 'DSD DoP Direct Experiment',
  'audioDrawer.option.asioNativeDsd': 'ASIO Native DSD Experiment',
  'audioDrawer.option.dsdAutoVolumeLock': 'Auto-lock volume while playing DSD',
  'audioDrawer.option.releaseExclusiveOnPause': 'Release Exclusive on Pause',
  'audioDrawer.option.active': 'On',
  'audioDrawer.option.set': 'Set',
  'audioDrawer.option.automix': 'Enable Automix',
  'audioDrawer.option.automixActive': 'Current playback is running through the Automix premix path.',
  'audioDrawer.option.automixDescription': 'Off by default. When enabled, continuous queue playback overlaps the current outro with the next intro using an automatic crossfade.',
  'audioDrawer.option.rememberOutput': 'Save Output Settings',
  'audioDrawer.option.rememberOutputDescription': 'Restores the selected output device, output mode, buffer, and related settings on the next launch.',
  'audioDrawer.option.fixedVolume': 'Fixed Volume',
  'audioDrawer.option.fixedVolumeDescription': 'When enabled, ECHO volume control is locked at 100%; ReplayGain still applies independently.',
  'audioDrawer.option.lowLoadPlaybackMode': 'Low-Load Playback Mode',
  'audioDrawer.option.lowLoadPlaybackModeDescription': 'Disables real-time spectrum, frequent playback page refreshes, ReplayGain/BPM re-analysis, high-frequency word lyrics updates, automatic deep lyric search, cover/artist image fetching, and MV preload while playing.',
  'audioDrawer.option.lowLoadPlaybackEnhancements': 'Enhanced Low-Load Protection',
  'audioDrawer.option.lowLoadPlaybackEnhancementsDescription': 'Off by default. Only applies with Low-Load Playback Mode enabled, further reducing polling, desktop lyrics, diagnostics, background library work, streaming prewarm, and automatic MV search.',
  'audioDrawer.option.showAsioPanelSettings': 'Show ASIO panel settings',
  'audioDrawer.option.showAsioPanelSettingsDescription': 'Off by default. When enabled, ASIO devices show an Open ASIO Panel button.',
  'audioDrawer.option.alsaShared': 'ALSA',
  'audioDrawer.option.alsaSharedDescription': 'Output through Linux ALSA devices.',
  'audioDrawer.option.directSound': 'DirectSound Compatibility',
  'audioDrawer.option.directSoundDescription': 'Manual compatibility mode with high latency; try only when WASAPI playback fails.',
  'audioDrawer.option.linuxAutoShared': 'Auto',
  'audioDrawer.option.linuxAutoSharedDescription': 'Prefer ALSA and respect the system PipeWire/ALSA compatibility layer.',
  'audioDrawer.option.sharedBackend': 'Shared backend',
  'audioDrawer.option.wasapiShared': 'WASAPI Shared',
  'audioDrawer.option.wasapiSharedDescription': 'Everyday Windows shared output path.',
  'audioDrawer.option.wasapiExclusive': 'WASAPI Exclusive Mode',
  'audioDrawer.option.wasapiExclusiveDescription': 'Shared is the everyday Windows path. Exclusive opens the same device without the shared mixer and is recommended only when your DAC or audio interface and driver are known to be stable; onboard Realtek-style drivers can be fragile and may cause silence, stutter, or switch failures.',
  'audioDrawer.section.advancedOutput': 'Advanced Audio Engine',
  'audioDrawer.section.advancedOutputDescription': 'For external audio interfaces, WASAPI Exclusive, ASIO, and HiFi debugging',
  'audioDrawer.section.automix': 'Automix',
  'audioDrawer.section.asioDevices': 'ASIO Output Devices',
  'audioDrawer.section.currentOutput': 'Current Output',
  'audioDrawer.section.hiddenDevices': 'Hidden Devices',
  'audioDrawer.section.systemDevices': 'Recommended Output',
  'audioDrawer.signal.balanceDsp': 'Balance DSP',
  'audioDrawer.signal.bitPerfect': 'Bit-perfect',
  'audioDrawer.signal.dspOn': 'DSP On',
  'audioDrawer.signal.eqOff': 'EQ Off',
  'audioDrawer.signal.eqOn': 'EQ On',
  'audioDrawer.signal.asioSdkOutput': 'ASIO SDK output',
  'audioDrawer.signal.ffmpegDecode': 'FFmpeg decode',
  'audioDrawer.signal.dsdDop': 'DSF bitstream -> DoP',
  'audioDrawer.signal.dsdDopFallback': 'DSD DoP fallback',
  'audioDrawer.signal.dsdDopStandby': 'DoP not used',
  'audioDrawer.signal.juceDecode': 'JUCE decode',
  'audioDrawer.signal.juceDecodeFallback': 'JUCE decode fallback',
  'audioDrawer.signal.juceDecodeStandby': 'JUCE decode not used',
  'audioDrawer.signal.nativeRate': 'Native Rate',
  'audioDrawer.signal.noActiveSource': 'No active source',
  'audioDrawer.signal.pending': 'Pending',
  'audioDrawer.signal.processed': 'Processed',
  'audioDrawer.signal.sharedMixer': 'Shared Mixer',
  'audioDrawer.signal.standardPath': 'Standard path',
  'audioDrawer.status.noTrack': 'No track',
  'audioDrawer.status.ratePending': 'Rate pending',
  'audioDrawer.status.sampleRatePending': 'Sample rate pending',
  'audioDrawer.title': 'Audio Settings',
  'audioDrawer.warning.highOutputSampleRate': 'The current audio device sample rate is too high and may cause playback speed problems. 48 kHz is recommended.',
  'audioProfessional.action.hideDetails': 'Hide professional details',
  'audioProfessional.action.refresh': 'Refresh status',
  'audioProfessional.action.showDetails': 'Show professional details',
  'audioProfessional.badge.bitPerfect': 'Bit-perfect',
  'audioProfessional.badge.dsp': 'DSP active',
  'audioProfessional.badge.protect': 'Protect',
  'audioProfessional.badge.replayGain': 'ReplayGain',
  'audioProfessional.badge.resampling': 'Resampling',
  'audioProfessional.badge.sampleMismatch': 'Sample-rate mismatch',
  'audioProfessional.badge.warning': 'Device issue/warning',
  'audioProfessional.issue.reason': 'Reason',
  'audioProfessional.issue.audioLevelClipped': 'Real-time level metering detected clipping. Lower preamp gain or disable gain-boosting DSP.',
  'audioProfessional.issue.audioLevelClippingRisk': 'Real-time level is near 0 dBFS and may clip.',
  'audioProfessional.issue.dspClippingRisk': 'DSP chain output has clipping risk. Protect limiter is armed and monitoring.',
  'audioProfessional.issue.dspLimiterProtecting': 'Protect limiter is actively protecting the output because post-DSP signal exceeded the safe threshold.',
  'audioProfessional.issue.roomCorrectionBitPerfectDisabled': 'Room correction disables bit-perfect output.',
  'audioProfessional.issue.roomCorrectionClippingRisk': 'Room correction output has clipping risk. Lower FIR Trim or enable Auto Gain.',
  'audioProfessional.issue.sharedMixRateTooHigh': 'Windows shared rate is too high: the device is at {deviceRate} while ECHO is outputting {decoderRate} PCM, so playback may sound sped up. Set the Windows default format to 48 kHz.',
  'audioProfessional.issue.windowsDefaultFormatUnusual': 'The Windows default format looks too high: it is currently {deviceRate}. ECHO will only warn you and will not change system settings; 48 kHz is recommended.',
  'audioProfessional.group.directDsp': 'Direct And DSP',
  'audioProfessional.group.playbackChain': 'Playback Chain',
  'audioProfessional.group.sampleRate': 'Sample-Rate Chain',
  'audioProfessional.group.stability': 'Stability',
  'audioProfessional.signal.decode': 'Decode',
  'audioProfessional.signal.dsp': 'DSP',
  'audioProfessional.signal.fir': 'FIR',
  'audioProfessional.signal.headroom': 'Headroom',
  'audioProfessional.signal.native': 'Native',
  'audioProfessional.signal.output': 'Output',
  'audioProfessional.signal.source': 'Source',  'audioProfessional.row.actualBuffer': 'Actual buffer',
  'audioProfessional.row.actualDeviceSampleRate': 'Actual device rate',
  'audioProfessional.row.bitDepth': 'Bit depth',
  'audioProfessional.row.bitPerfect': 'Bit-perfect',
  'audioProfessional.row.bitrate': 'Bitrate',
  'audioProfessional.row.buffered': 'Buffered',
  'audioProfessional.row.channelBalance': 'Channel balance',
  'audioProfessional.row.channels': 'Channels',
  'audioProfessional.row.clippingProtection': 'Clipping protection',
  'audioProfessional.row.codec': 'Codec',
  'audioProfessional.row.decodeBackend': 'Decode backend',
  'audioProfessional.row.decoderOutputSampleRate': 'Decoder output',
  'audioProfessional.row.deviceBuffer': 'Device buffer',
  'audioProfessional.row.eq': 'EQ',
  'audioProfessional.row.error': 'Error',
  'audioProfessional.row.fileSampleRate': 'Source rate',
  'audioProfessional.row.latencyProfile': 'Latency profile',
  'audioProfessional.row.outputBackend': 'Output backend',
  'audioProfessional.row.outputDevice': 'Output device',
  'audioProfessional.row.outputLatency': 'Output latency',
  'audioProfessional.row.outputMode': 'Output mode',
  'audioProfessional.row.replayGain': 'ReplayGain',
  'audioProfessional.row.protectLimiter': 'Protect limiter',
  'audioProfessional.row.roomCorrection': 'Room correction',
  'audioProfessional.row.requestedBuffer': 'Requested buffer',
  'audioProfessional.row.requestedOutputSampleRate': 'Requested output',
  'audioProfessional.row.resampler': 'Resampler',
  'audioProfessional.row.resampling': 'Resampling',
  'audioProfessional.row.sampleRateMismatch': 'Sample-rate mismatch',
  'audioProfessional.row.signalPath': 'Signal path',
  'audioProfessional.row.sharedDeviceSampleRate': 'Shared device rate',
  'audioProfessional.row.sharedStability': 'Shared stability',
  'audioProfessional.row.soxr': 'SOXR',
  'audioProfessional.row.state': 'State',
  'audioProfessional.row.underrun': 'Underrun',
  'audioProfessional.row.warnings': 'Warnings',
  'audioProfessional.summary.pending': 'Waiting for audio status',
  'audioProfessional.title': 'Professional Playback Status',
  'audioProfessional.value.disabled': 'Disabled',
  'audioProfessional.value.dspPath': 'DSP Path: {modules}',
  'audioProfessional.value.enabled': 'Enabled',
  'audioProfessional.value.nativePath': 'Native Path',
  'audioProfessional.value.no': 'No',
  'audioProfessional.value.pending': 'Pending',
  'audioProfessional.value.ready': 'Ready',
  'audioProfessional.value.sharedMixer': 'Shared mixer',
  'audioProfessional.value.systemDefault': 'System default output',
  'audioProfessional.value.unknown': 'n/a',
  'audioProfessional.value.yes': 'Yes',
  'audioDrawer.todo.outputControls': 'Target sample rate and buffer controls',
  'audioDrawer.todo.outputControlsDescription': 'TODO: wire to real audio settings when DeviceService exposes safe controls.',
  'audioDrawer.troubleshooting.description': 'Use this when audio is stuck or the device list looks wrong. The soft restart only affects ECHO.',
  'audioDrawer.troubleshooting.hardAction': 'Restart Windows Audio Service',
  'audioDrawer.troubleshooting.hardBusy': 'Restarting Windows Audio Service',
  'audioDrawer.troubleshooting.hardConfirm': 'This will interrupt audio from all apps (Chrome, games, calls) and requires administrator permission. Continue?',
  'audioDrawer.troubleshooting.hardDone': 'Windows audio service recovered. You can start playback again.',
  'audioDrawer.troubleshooting.softAction': 'Restart Audio Engine',
  'audioDrawer.troubleshooting.softBusy': 'Restarting Audio Engine',
  'audioDrawer.troubleshooting.softDone': 'Audio engine restarted. You can start playback again.',
  'audioDrawer.troubleshooting.title': 'Audio Troubleshooting',
  'folders.action.addScan': 'Add + scan',
  'folders.action.browse': 'Browse',
  'folders.action.cancel': 'Cancel',
  'folders.action.open': 'Open',
  'folders.action.play': 'Play',
  'folders.action.queue': 'Queue',
  'folders.action.random': 'Random',
  'folders.action.refresh': 'Refresh folders',
  'folders.action.remove': 'Remove',
  'folders.action.scan': 'Scan',
  'folders.confirm.deleteTrack': 'Delete the music file?\n{title}',
  'folders.confirm.removeRoot': 'Remove "{name}" from the library index? Music files stay on disk.',
  'folders.count.tracks': '{count} tracks',
  'folders.detail.importHint': 'Import a music folder to build a path-based library view.',
  'folders.detail.libraryFolders': 'Library folders',
  'folders.detail.root': 'Root',
  'folders.detail.selectFolder': 'Select a folder',
  'folders.detail.subfolder': 'Subfolder',
  'folders.duration.hours': '{count} hr',
  'folders.duration.hoursMinutes': '{hours} hr {minutes} min',
  'folders.duration.minutes': '{count} min',
  'folders.empty.noScan': 'No scan has run for this root yet.',
  'folders.empty.roots': 'No library folders yet.',
  'folders.error.actionFailed': 'Folder action failed.',
  'folders.error.desktopEditTags': 'Desktop bridge unavailable. Open ECHO Next desktop to edit embedded tags.',
  'folders.error.desktopFileActions': 'Desktop bridge unavailable. Open ECHO Next desktop to use file actions.',
  'folders.error.desktopImport': 'Desktop bridge unavailable. Open ECHO Next desktop to import folders.',
  'folders.error.desktopManage': 'Desktop bridge unavailable. Open ECHO Next desktop to manage folders.',
  'folders.error.noCoverSaved': 'No cover art was saved for this track.',
  'folders.error.noCoverToCopy': 'This track does not have cover art to copy.',
  'folders.error.notFolder': 'The selected path is not a folder.',
  'folders.error.pathMissing': 'Folder path does not exist.',
  'folders.error.permission': 'ECHO does not have permission to access this folder.',
  'folders.error.trackActionUnavailable': 'This track action is not available yet.',
  'folders.filters.includeSubfolders': 'Include subfolders',
  'folders.filters.label': 'Folder track filters',
  'folders.filters.searchPlaceholder': 'Search this folder...',
  'folders.message.addedToPlaylist': 'Added to playlist: {name}',
  'folders.message.alreadyScanning': 'This library root is already scanning.',
  'folders.message.folderAddedScanStarted': 'Folder added. Scan started in the background.',
  'folders.message.folderRemoved': 'Folder removed from the library index.',
  'folders.message.loadedPartial': 'Loaded first {loaded} of {total} tracks to keep memory low.',
  'folders.message.loadedTracks': 'Loaded {count} tracks.',
  'folders.message.noPlayableTracks': 'No playable tracks in this folder.',
  'folders.message.queuedTracks': 'Queued {count} tracks.',
  'folders.message.scanCancelled': 'Scan cancelled.',
  'folders.message.scanStarted': 'Scan started.',
  'folders.metrics.duration': 'Duration',
  'folders.metrics.label': 'Folder metrics',
  'folders.metrics.size': 'Size',
  'folders.metrics.subfolders': 'Subfolders',
  'folders.metrics.tracks': 'Tracks',
  'folders.panel.addFolder': 'Add folder',
  'folders.panel.import': 'Import',
  'folders.panel.manage': 'Manage',
  'folders.panel.scan': 'Scan',
  'folders.panel.selectedRoot': 'Selected root',
  'folders.panel.status': 'Status',
  'folders.phase.checkingCache': 'Checking cache',
  'folders.phase.discovering': 'Finding files',
  'folders.phase.extractingCovers': 'Covers',
  'folders.phase.finished': 'Finished',
  'folders.phase.groupingAlbums': 'Albums',
  'folders.phase.readingMetadata': 'Reading tags',
  'folders.phase.writingDatabase': 'Writing',
  'folders.prompt.choosePlaylist': 'Choose playlist number:\n{names}',
  'folders.prompt.createPlaylist': 'No playlists yet. Enter a name to create one:',
  'folders.queueSource.recursive': '{name} folder',
  'folders.scan.progress': '{processed}/{total} files, {errors} errors',
  'folders.sidebar.kicker': 'Library',
  'folders.sidebar.title': 'Folders',
  'folders.sort.album': 'Album',
  'folders.sort.artist': 'Artist',
  'folders.sort.duration': 'Duration',
  'folders.sort.quality': 'Quality',
  'folders.sort.random': 'Random',
  'folders.sort.recent': 'Recently updated',
  'folders.sort.title': 'Title',
  'folders.status.cancelled': 'Cancelled',
  'folders.status.completed': 'Complete',
  'folders.status.failed': 'Failed',
  'folders.status.queued': 'Queued',
  'folders.status.running': 'Scanning',
  'folders.statusLine.loadingTracks': 'Loading folder tracks...',
  'folders.statusLine.preparingQueue': 'Preparing folder queue...',
  'common.available': 'Available',
  'common.build': 'Build',
  'common.checking': 'Checking',
  'common.dev': 'Dev',
  'common.disabled': 'Disabled',
  'common.enabled': 'Enabled',
  'common.loading': 'Loading',
  'common.na': 'n/a',
  'common.no': 'No',
  'common.ready': 'Ready',
  'common.unavailable': 'Unavailable',
  'common.yes': 'Yes',
  'notice.browserFolderPicker': 'Browser preview opened a folder picker. Real library import uses the Electron desktop app.',
  'notice.browserFilePicker': 'Browser preview selected {name}. Open ECHO Next desktop to play it through Audio Core.',
  'notice.windowControlsDesktop': 'Window controls are available in the Electron desktop window.',
  'route.albums.description': 'Grouped album wall.',
  'route.albums.label': 'Albums',
  'route.artists.description': 'Browse by artist.',
  'route.artists.label': 'Artists',
  'route.audioSettings.description': 'Output and decoder settings.',
  'route.audioSettings.label': 'Audio Settings',
  'route.connect.description': 'DLNA / AirPlay wireless playback.',
  'route.connect.label': 'Connect',
  'route.dsp.description': 'Signal-chain tuning workbench.',
  'route.dsp.label': 'DSP',
  'connectPage.controls.aria': 'Connect controls',
  'connectPage.controls.disconnect': 'Disconnect',
  'connectPage.controls.pause': 'Pause',
  'connectPage.controls.play': 'Play',
  'connectPage.controls.stop': 'Stop',
  'connectPage.controls.volume': 'Cast volume',
  'connectPage.deviceState.available': 'Available',
  'connectPage.deviceState.connected': 'Connected',
  'connectPage.deviceState.unavailable': 'Offline',
  'connectPage.deviceState.unsupported': 'Experimental',
  'connectPage.devices.allHidden': 'All current devices are hidden',
  'connectPage.devices.aria': 'Device list',
  'connectPage.devices.collapse': 'Collapse network streamers',
  'connectPage.devices.empty': 'No network devices found',
  'connectPage.devices.emptyHint': 'Refresh to show streamers, TVs, HQPlayer, and AirPlay endpoints here.',
  'connectPage.devices.expand': 'Expand network streamers',
  'connectPage.devices.hiddenAria': 'Hidden network devices',
  'connectPage.devices.hiddenTitle': 'Hidden devices',
  'connectPage.devices.kicker': 'NETWORK STREAMERS',
  'connectPage.devices.restoreAll': 'Restore all',
  'connectPage.devices.restoreHint': 'You can restore hidden devices above.',
  'connectPage.devices.summary': '{streamers} streamers · {entries} endpoints · hidden {hidden}',
  'connectPage.devices.title': 'Network streamers',
  'connectPage.header.autoStart': 'Auto-enable AirPlay / DLNA on startup',
  'connectPage.header.description': 'Centralized control for DLNA / AirPlay / HQPlayer external playback. HQPlayer is currently focused on safe handoff validation.',
  'connectPage.header.kicker': 'WIRELESS PLAYBACK',
  'connectPage.header.refresh': 'Refresh devices',
  'connectPage.hqplayer.enable': 'Enable HQPlayer',
  'connectPage.hqplayer.kicker': 'EXTERNAL RENDERER',
  'connectPage.hqplayer.localDesktop': 'Local HQPlayer Desktop',
  'connectPage.hqplayer.state.available': 'Reachable',
  'connectPage.hqplayer.state.checking': 'Checking',
  'connectPage.hqplayer.state.disabled': 'Disabled',
  'connectPage.hqplayer.state.notConfigured': 'Port not configured',
  'connectPage.hqplayer.state.unavailable': 'Unavailable',
  'connectPage.hqplayer.test': 'Check HQPlayer',
  'connectPage.nowPlaying.aria': 'Current cast',
  'connectPage.nowPlaying.chooseDevice': 'Choose a network streamer to start casting',
  'connectPage.nowPlaying.coverReady': 'Cover URL sent',
  'connectPage.nowPlaying.coverWaiting': 'Waiting for cover URL',
  'connectPage.nowPlaying.dlnaPolling': 'Status polling about every 3s',
  'connectPage.nowPlaying.emptyTitle': 'No current track',
  'connectPage.nowPlaying.infoAria': 'Current cast details',
  'connectPage.nowPlaying.infoWaiting': 'Waiting for cast details',
  'connectPage.nowPlaying.latency': 'Cast handshake {ms}ms',
  'connectPage.nowPlaying.noOutput': 'No output connected',
  'connectPage.nowPlaying.progressAria': 'Cast progress',
  'connectPage.outgoing.aria': 'DLNA outgoing request log',
  'connectPage.outgoing.empty': 'No pulls yet',
  'connectPage.outgoing.note': 'Device cover or audio pulls will show here.',
  'connectPage.outgoing.recent': '{count} recent',
  'connectPage.outgoing.title': 'DLNA Out',
  'connectPage.receiver.aria': 'Receive from phone',
  'connectPage.receiver.disable': 'Disable receiver',
  'connectPage.receiver.discoveryHint': 'Phones can discover this after enabling it',
  'connectPage.receiver.enable': 'Enable receiver',
  'connectPage.receiver.fromClient': 'From {address}',
  'connectPage.receiver.kicker': 'RECEIVER',
  'connectPage.receiver.noClient': 'No phone connected',
  'connectPage.receiver.preparing': 'Preparing local network address',
  'connectPage.receiver.progressAria': 'Receiver playback progress',
  'connectPage.receiver.state.disabled': 'Disabled',
  'connectPage.receiver.state.idle': 'Waiting for phone',
  'connectPage.receiver.state.loading': 'Loading',
  'connectPage.receiver.state.playing': 'Receiving from phone',
  'connectPage.receiver.state.ready': 'Media received',
  'connectPage.receiver.stop': 'Stop receiver playback',
  'connectPage.receiver.title': 'Receive from phone',
  'connectPage.receiver.waitingTitle': 'Waiting for phone casting',
  'connectPage.stage.aria': 'Quick cast',
  'connectPage.state.connecting': 'Connecting',
  'connectPage.state.discovering': 'Scanning devices',
  'connectPage.state.error': 'Error',
  'connectPage.state.idle': 'Idle',
  'connectPage.state.paused': 'Paused',
  'connectPage.state.playing': 'Casting',
  'connectPage.state.stopped': 'Stopped',
  'connectPage.airplay.state.idle': 'Waiting for iPhone',
  'connectPage.airplay.state.playing': 'AirPlay playing',
  'connectPage.airplay.state.starting': 'Starting',
  'connectPage.airplay.state.unavailable': 'Native backend unavailable',
  'connectPage.airplay.waitingTitle': 'Waiting for iPhone casting',
  'route.downloads.description': 'Download queue placeholder.',
  'route.downloads.label': 'Downloads',
  'route.folders.description': 'Local import roots.',
  'route.folders.label': 'Folders',
  'route.history.description': 'Playback history.',
  'route.history.label': 'History',
  'historyPage.action.clear': 'Clear history',
  'historyPage.action.refreshInvalid': 'Refresh invalid songs',
  'historyPage.confirm.clear': 'Clear playback history? This will not delete your music files or empty the library.',
  'historyPage.date.none': 'None yet',
  'historyPage.duration.hoursMinutes': '{hours} hr {minutes} min',
  'historyPage.duration.minutes': '{count} min',
  'historyPage.empty.description': 'Play a song and your recent listening will show up here.',
  'historyPage.empty.title': 'No playback history yet.',
  'historyPage.error.desktopBridgeRead': 'Desktop bridge unavailable. Open ECHO Next in Electron to read playback history.',
  'historyPage.filter.all': 'All',
  'historyPage.filter.completed': 'Completed only',
  'historyPage.filter.month': 'This month',
  'historyPage.filter.today': 'Today',
  'historyPage.filter.week': 'This week',
  'historyPage.header.kicker': 'Recent playback history',
  'historyPage.header.title': 'History',
  'historyPage.list.aria': 'Playback history list',
  'historyPage.list.doubleClick': 'Double-click to play',
  'historyPage.list.source': 'From {source}',
  'historyPage.list.unknownAlbum': 'Unknown album',
  'historyPage.list.unknownArtist': 'Unknown artist',
  'historyPage.list.unknownSource': 'Unknown source',
  'historyPage.loadMore': 'Load more',
  'historyPage.loading': 'Loading playback history...',
  'historyPage.loadingMore': 'Loading...',
  'historyPage.metric.plays': '{count} plays',
  'historyPage.metric.tracks': '{count} tracks',
  'historyPage.refresh.none': 'No invalid history songs found.',
  'historyPage.refresh.removed': 'Removed {count} invalid history songs.',
  'historyPage.refresh.running': 'Refreshing...',
  'historyPage.recent.aria': 'Recently played list',
  'historyPage.recent.count': '{count} recent',
  'historyPage.recent.empty': 'No recent playback yet.',
  'historyPage.recent.kicker': 'Sorted by time',
  'historyPage.recent.title': 'Recently played',
  'historyPage.search.placeholder': 'Search title, artist, album, or path',
  'historyPage.summary.all.count': 'Total plays',
  'historyPage.summary.all.duration': 'Total time',
  'historyPage.summary.all.group': 'Sorted by play count',
  'historyPage.summary.all.latest': 'Last played',
  'historyPage.summary.all.tracks': 'History tracks',
  'historyPage.summary.aria': 'History overview',
  'historyPage.summary.completed.count': 'Completed plays',
  'historyPage.summary.completed.duration': 'Completed play time',
  'historyPage.summary.completed.group': 'Sorted by completed plays',
  'historyPage.summary.completed.latest': 'Last completed play',
  'historyPage.summary.completed.tracks': 'Completed tracks',
  'historyPage.summary.month.count': 'Monthly plays',
  'historyPage.summary.month.duration': 'Monthly time',
  'historyPage.summary.month.group': 'Sorted by monthly plays',
  'historyPage.summary.month.latest': 'Last played this month',
  'historyPage.summary.month.tracks': 'Monthly tracks',
  'historyPage.summary.today.count': 'Today plays',
  'historyPage.summary.today.duration': 'Today time',
  'historyPage.summary.today.group': 'Sorted by today plays',
  'historyPage.summary.today.latest': 'Last played today',
  'historyPage.summary.today.tracks': 'Today tracks',
  'historyPage.summary.week.count': 'Weekly plays',
  'historyPage.summary.week.duration': 'Weekly time',
  'historyPage.summary.week.group': 'Sorted by weekly plays',
  'historyPage.summary.week.latest': 'Last played this week',
  'historyPage.summary.week.tracks': 'Weekly tracks',
  'historyPage.toolbar.aria': 'History filters',
  'route.home.description': 'Library overview and recent listening.',
  'route.home.label': 'Home',
  'home.artistLeaderboard.aria': 'Artist leaderboard',
  'home.artistLeaderboard.completionRate': '{rate}% completed',
  'home.artistLeaderboard.emptyDescription': 'Play more music and your most frequent artists will show up here.',
  'home.artistLeaderboard.emptyTitle': 'No artist leaderboard yet',
  'home.artistLeaderboard.playCount': '{count} plays',
  'home.artistLeaderboard.title': 'Artist leaderboard',
  'home.count.tracks': '{count} tracks',
  'home.date.none': 'No history yet',
  'home.date.unknown': 'Unknown time',
  'home.duration.hoursMinutes': '{hours} hr {minutes} min',
  'home.duration.hoursOnly': '{hours} hr',
  'home.duration.minutes': '{count} min',
  'home.duration.zeroMinutes': '0 min',
  'home.error.albumNotFound': 'Album not found: {album}',
  'home.error.artistNotFound': 'Artist not found: {artist}',
  'home.error.desktopBridgeRandom': 'Desktop library bridge unavailable. Generate a random queue from the ECHO Next desktop app.',
  'home.error.desktopBridgeRecommend': 'Desktop library bridge unavailable. Refresh recommendations from the ECHO Next desktop app.',
  'home.error.desktopBridgeView': 'Desktop library bridge unavailable. Open Home in the ECHO Next desktop app.',
  'home.favoriteAlbums.aria': 'Albums you like',
  'home.favoriteAlbums.emptyDescription': 'Play more albums and the top four by play count will appear here.',
  'home.favoriteAlbums.emptyTitle': 'No frequent albums yet',
  'home.favoriteAlbums.title': 'Albums you like',
  'home.hero.action.continue': 'Resume playback',
  'home.hero.action.viewQueue': 'View queue',
  'home.hero.aria': 'Today Echo',
  'home.hero.defaultTitle': 'Start from your music library.',
  'home.hero.description.empty': 'After you import music, this becomes your library entry point, recent plays, and weekly listening pulse.',
  'home.hero.description.resume': 'Pick up with "{title}" by {artist}, or start from one of your recent additions.',
  'home.hero.kicker': 'Today Echo',
  'home.hero.nowPlaying': 'Now playing',
  'home.hero.recentSignal': 'Recent signal',
  'home.hero.statsAria': 'Library stats',
  'home.metric.albums': 'Albums',
  'home.metric.albumsDetail': 'Grouped by release',
  'home.metric.artists': 'Artists',
  'home.metric.folders': 'Folders',
  'home.metric.foldersDetail': 'Last scanned {date}',
  'home.metric.openAria': 'Open {label}',
  'home.metric.songs': 'Songs',
  'home.metric.songsDetail': 'Total {duration}',
  'home.month.label': '{month} mo',
  'home.nowMeta.empty': 'Recent items will appear here once your library is ready',
  'home.preferences.aria': 'Playback preferences',
  'home.recent.emptyAddedDescription': 'After you import a folder, the newest covers added to your library will show here.',
  'home.recent.emptyAddedTitle': 'No recent additions yet',
  'home.recent.emptyPlayedDescription': 'Once playback starts, albums you listened to recently will show up here.',
  'home.recent.emptyPlayedTitle': 'No recent playback yet',
  'home.recent.nextPage': 'Next page',
  'home.recent.prevPage': 'Previous page',
  'home.recent.tab.added': 'Added',
  'home.recent.tab.played': 'Played',
  'home.recent.tabsAria': 'Recent content',
  'home.recent.title': 'Recent activity',
  'home.recommend.emptyDescription': 'Import albums and this area will fill with your library right away.',
  'home.recommend.emptyTitle': 'No albums to recommend yet',
  'home.recommend.refresh': 'Refresh',
  'home.recommend.refreshing': 'Refreshing',
  'home.recommend.title': 'Recommended for you',
  'home.signalVisualizer.aria': 'Audio visualizer',
  'home.status.loading': 'Preparing Home...',
  'home.week.emptyHint': 'After playback starts, the grid lights up to your weekly rhythm.',
  'home.week.listenDuration': 'Listening time',
  'home.week.playCount': 'This week',
  'home.week.times': 'plays',
  'home.week.title': 'Weekly Echo',
  'home.weekday.fri': 'F',
  'home.weekday.mon': 'M',
  'home.weekday.wed': 'W',
  'home.weeklyHeatmap.activeWeeks': '{count} active weeks',
  'home.weeklyHeatmap.aria': 'Playback heatmap for the last {weeks} weeks',
  'home.weeklyHeatmap.dayAria': '{date}, {playCount} plays',
  'home.weeklyHeatmap.dayTitle': '{date} · {playCount} plays · {duration}',
  'route.inbox.description': 'New tracks from each scan.',
  'route.inbox.label': 'Inbox',
  'inboxPage.action.addToQueue': 'Add to queue',
  'inboxPage.action.generatePlaylist': 'Create later playlist',
  'inboxPage.batch.latest': 'Latest scan',
  'inboxPage.batch.recentAll': 'Recent all scans',
  'inboxPage.batch.selected': 'Selected scan',
  'inboxPage.date.none': 'No record yet',
  'inboxPage.empty.description': 'After one library scan, newly added songs will appear here.',
  'inboxPage.empty.noMatch': 'No matching new songs',
  'inboxPage.empty.title': 'No new additions yet',
  'inboxPage.empty.tryFilter': 'Try a different filter.',
  'inboxPage.error.desktopBridgeRead': 'Desktop bridge is temporarily unavailable, so the library inbox cannot be read.',
  'inboxPage.facets.allAlbums': 'All albums',
  'inboxPage.facets.allArtists': 'All artists',
  'inboxPage.facets.allFolders': 'All folders',
  'inboxPage.facets.aria': 'Library inbox dimension filters',
  'inboxPage.filter.all': 'All additions',
  'inboxPage.filter.aria': 'Issue category filters',
  'inboxPage.filter.clear': 'Clear filters',
  'inboxPage.filter.metadataIssue': 'Metadata issues',
  'inboxPage.filter.missingCover': 'Missing covers',
  'inboxPage.filter.suspiciousFile': 'Suspicious files',
  'inboxPage.filter.unknownAlbum': 'Unknown album',
  'inboxPage.filter.unknownArtist': 'Unknown artist',
  'inboxPage.hero.kicker': 'LIBRARY INBOX',
  'inboxPage.loading': 'Loading inbox...',
  'inboxPage.processing.aria': 'Items needing attention',
  'inboxPage.processing.pending': 'Listen later / pending',
  'inboxPage.quality.aria': 'Import quality summary',
  'inboxPage.quality.coverCompleteness': 'Cover completeness',
  'inboxPage.quality.metadataCompleteness': 'Metadata completeness',
  'inboxPage.quality.unknownArtistAlbum': 'Unknown artist / album',
  'inboxPage.search.aria': 'Search library inbox',
  'inboxPage.search.placeholder': 'Search title, artist, album, path',
  'inboxPage.stats.aria': 'Library inbox summary',
  'inboxPage.stats.currentResults': 'Current results',
  'inboxPage.stats.newSongs': 'New songs',
  'inboxPage.status.all': 'All states',
  'inboxPage.status.aria': 'Processing state filters',
  'inboxPage.status.ignored': 'Ignored',
  'inboxPage.status.pending': 'Pending',
  'inboxPage.status.processed': 'Processed',
  'inboxPage.story.aria': 'Import story',
  'inboxPage.story.clean': '{summary}. Everything looks pretty clean.',
  'inboxPage.story.empty': 'After a scan completes, ECHO will organize newly added songs, albums, and metadata issues here.',
  'inboxPage.story.kicker': 'IMPORT STORY',
  'inboxPage.story.newAlbums': 'New albums',
  'inboxPage.story.newArtists': 'New artists',
  'inboxPage.story.summaryAlbums': '{count} albums',
  'inboxPage.story.summaryArtists': '{count} artists',
  'inboxPage.story.summaryTracks': '{scope} added {count} tracks',
  'inboxPage.story.totalDuration': 'Total duration',
  'inboxPage.story.warningMetadataIssue': '{count} tracks with metadata issues',
  'inboxPage.story.warningMissingCover': '{count} tracks missing covers',
  'inboxPage.story.withWarnings': '{summary}. Including {warnings}.',
  'inboxPage.toolbar.aria': 'Library inbox filters',
  'inboxPage.toolbar.batch': 'Batch',
  'route.importFile.description': 'Import a single audio file.',
  'route.importFile.label': 'Import File',
  'route.importFolder.description': 'Choose a local music folder.',
  'route.importFolder.label': 'Import Folder',
  'importFolder.hero.note': 'This page is only for importing local library folders and checking scan status.',
  'nowPlaying.action.openLyrics': 'Open lyrics',
  'nowPlaying.description': 'Current track overview. Use the microphone button in the bottom player to open the dedicated lyrics page.',
  'nowPlaying.emptyDescription': 'Start playback from Songs or Albums and the current track will appear here.',
  'nowPlaying.emptyTitle': 'Nothing is playing',
  'nowPlaying.kicker': 'Now Playing',
  'nowPlaying.localFile': 'Local file',
  'nowPlaying.ready': 'Ready',
  'nowPlaying.state.idle': 'Idle',
  'nowPlaying.state.playing': 'Playing',
  'nowPlaying.title': 'Now Playing',
  'route.liked.description': 'Saved tracks.',
  'route.liked.label': 'Liked',
  'route.lyrics.description': 'Lyrics and immersive playback.',
  'route.lyrics.label': 'Lyrics',
  'route.lyricsSettings.description': 'Lyrics preferences.',
  'route.lyricsSettings.label': 'Lyrics Settings',
  'lyricsSettings.action.choose': 'Choose',
  'lyricsSettings.action.fonts': 'Fonts',
  'lyricsSettings.action.match': 'Match',
  'lyricsSettings.action.music': 'Music',
  'lyricsSettings.action.reset': 'Reset',
  'lyricsSettings.action.search': 'Search',
  'lyricsSettings.background.blur': 'Background blur',
  'lyricsSettings.background.brightness': 'Background brightness',
  'lyricsSettings.background.chooseWallpaper': 'Choose custom wallpaper',
  'lyricsSettings.background.clearWallpaper': 'Clear custom wallpaper',
  'lyricsSettings.background.clearWallpaperHint': 'Restore follow theme',
  'lyricsSettings.background.highResolutionCover': 'Request high-res covers from network metadata',
  'lyricsSettings.background.highResolutionCoverDescription': 'Only request a high-res cover temporarily when following the cover; when off, local cover art is used as fallback.',
  'lyricsSettings.background.mode.cover': 'Follow cover',
  'lyricsSettings.background.mode.coverColor': 'Cover color',
  'lyricsSettings.background.mode.customWallpaper': 'Custom wallpaper',
  'lyricsSettings.background.mode.theme': 'Follow theme',
  'lyricsSettings.background.modeAria': 'Lyrics background mode',
  'lyricsSettings.background.modeDescription': 'Cover mode uses the current track cover; cover color extracts only the main cover color; custom wallpapers are saved to the app data directory.',
  'lyricsSettings.background.opacity': 'Background opacity',
  'lyricsSettings.background.readability': 'Lyrics readability boost',
  'lyricsSettings.background.readabilityDescription': 'Adds outline and shadow to lyrics over immersive MV backgrounds; this can stay on without expanding immersive MV background settings.',
  'lyricsSettings.background.scale': 'Background scale',
  'lyricsSettings.background.showControls': 'Show lyrics background settings',
  'lyricsSettings.background.smartReadable': 'Smart readable colors',
  'lyricsSettings.background.smartReadableDescription': 'Automatically picks high-contrast text colors from the cover, wallpaper, or MV frame, adding a light mask, outline, and shadow when needed. Manual lyrics color is used when off.',
  'lyricsSettings.background.title': 'Lyrics Background',
  'lyricsSettings.background.tuning': 'Background tuning',
  'lyricsSettings.background.tuningDescription': 'Follow cover and custom wallpaper both use these opacity, blur, and brightness settings.',
  'lyricsSettings.background.wallpaperSaved': 'Saved to the app wallpaper directory',
  'lyricsSettings.candidate.allSources': 'All sources',
  'lyricsSettings.candidate.results': 'Lyrics search results',
  'lyricsSettings.candidate.risk.high': 'Needs review',
  'lyricsSettings.candidate.risk.low': 'Exact match',
  'lyricsSettings.candidate.risk.medium': 'Possible match',
  'lyricsSettings.candidate.reason.albumMatch': 'Album match',
  'lyricsSettings.candidate.reason.artistExact': 'Artist exact',
  'lyricsSettings.candidate.reason.artistMismatch': 'Artist mismatch',
  'lyricsSettings.candidate.reason.autoAccept': 'Auto accepted',
  'lyricsSettings.candidate.reason.candidateOnlyCover': 'Cover needs review',
  'lyricsSettings.candidate.reason.candidateOnlyDuration': 'Duration needs review',
  'lyricsSettings.candidate.reason.coverIntent': 'Cover candidate',
  'lyricsSettings.candidate.reason.durationClose': 'Duration close',
  'lyricsSettings.candidate.reason.durationExact': 'Duration exact',
  'lyricsSettings.candidate.reason.durationMismatch': 'Duration mismatch',
  'lyricsSettings.candidate.reason.embeddedTag': 'Embedded lyrics',
  'lyricsSettings.candidate.reason.localSidecar': 'Local lyrics',
  'lyricsSettings.candidate.reason.rejectedByUser': 'Rejected',
  'lyricsSettings.candidate.reason.syncedDurationSafe': 'Synced safe',
  'lyricsSettings.candidate.reason.titleExact': 'Title exact',
  'lyricsSettings.candidate.reason.titleSimilar': 'Title similar',
  'lyricsSettings.candidate.reason.versionConflict': 'Version conflict',
  'lyricsSettings.candidate.reason.versionMatch': 'Version match',
  'lyricsSettings.candidate.sourceFilters': 'Lyrics source filters',
  'lyricsSettings.candidate.type.instrumental': 'Instrumental',
  'lyricsSettings.candidate.type.lyrics': 'Lyrics',
  'lyricsSettings.candidate.type.plain': 'Plain',
  'lyricsSettings.candidate.type.synced': 'Synced',
  'lyricsSettings.currentTrack.instrumentalMarked': 'Marked as instrumental',
  'lyricsSettings.currentTrack.markInstrumental': 'Mark as instrumental',
  'lyricsSettings.currentTrack.markInstrumentalHint': 'Remember this track and stop automatic lyrics matching',
  'lyricsSettings.currentTrack.rematch': 'Rematch',
  'lyricsSettings.currentTrack.rematchHint': 'Clear the current cache and search again',
  'lyricsSettings.currentTrack.restartOnApply': 'Auto-replay after applying lyrics',
  'lyricsSettings.currentTrack.restartOnApplyDescription': 'Off by default. When enabled, ECHO restarts the current song after lyrics are applied so the new timeline starts cleanly.',
  'lyricsSettings.currentTrack.searchHint': 'Leave empty to use the current track info',
  'lyricsSettings.currentTrack.searchInput': 'Lyrics search text',
  'lyricsSettings.currentTrack.searchLyrics': 'Search lyrics',
  'lyricsSettings.currentTrack.searchPlaceholder': 'Title / artist / keyword',
  'lyricsSettings.currentTrack.title': 'Current Track',
  'lyricsSettings.display.autoOpenCandidatePanel': 'Auto open lyrics chooser',
  'lyricsSettings.display.chooseMiniPlayerColor': 'Choose bottom bar color',
  'lyricsSettings.display.coverMiniPlayerHint': 'Extracts color from the current cover and darkens it into a glass color that keeps buttons readable.',
  'lyricsSettings.display.customColor': 'Custom color',
  'lyricsSettings.display.defaultMicrosoftYahei': 'Defaults to Microsoft YaHei; you can switch to a system font',
  'lyricsSettings.display.desktopFont': 'Desktop lyrics font',
  'lyricsSettings.display.desktopLyrics': 'Desktop Lyrics',
  'lyricsSettings.display.desktopLyricsDescription': 'Shows the current lyrics in an independent transparent always-on-top desktop window.',
  'lyricsSettings.display.desktopOpacity': 'Desktop lyrics opacity',
  'lyricsSettings.display.desktopOpacityDescription': 'Currently {opacity}%; lower it to reduce visual blocking.',
  'lyricsSettings.display.desktopRomanization': 'Show romanization in desktop lyrics',
  'lyricsSettings.display.desktopTranslation': 'Show translation in desktop lyrics',
  'lyricsSettings.display.disableMvTrackInfoAutoShow': 'Disable MV auto track info',
  'lyricsSettings.display.enableLyrics': 'Enable lyrics',
  'lyricsSettings.display.enableLyricsDescription': 'When off, the lyrics page will not load, search, or match lyrics.',
  'lyricsSettings.display.hideEmptyState': 'Hide instrumental notice',
  'lyricsSettings.display.hideEmptyStateDescription': 'Hide the centered instrumental and no-lyrics prompts on the lyrics page. Enabled by default.',
  'lyricsSettings.display.hideTrackInfo': 'Hide track info',
  'lyricsSettings.display.lockDesktopLyrics': 'Lock desktop lyrics',
  'lyricsSettings.display.lockDesktopLyricsDescription': 'When locked, the mouse passes through desktop lyrics so they do not block desktop actions. Return here to unlock.',
  'lyricsSettings.display.matchThreshold': 'Lyrics match threshold',
  'lyricsSettings.display.matchThresholdDescription': 'Automatically apply online results only at {threshold}% or higher',
  'lyricsSettings.display.miniPlayer': 'Mini bottom bar',
  'lyricsSettings.display.miniPlayerAutoHide': 'Auto-hide mini bottom bar',
  'lyricsSettings.display.miniPlayerAutoHideDescription': 'When enabled, the bar tucks away after the pointer moves far enough from it, then glides back when the pointer returns near the bottom. Off by default.',
  'lyricsSettings.display.miniPlayerAutoMv': 'Auto-enable while playing MV',
  'lyricsSettings.display.miniPlayerAutoMvDescription': 'Uses the mini bottom bar automatically on the MV page; normal lyrics pages still follow the switch above.',
  'lyricsSettings.display.miniPlayerColor': 'Bottom bar color',
  'lyricsSettings.display.miniPlayerColorMode': 'Mini bottom bar color mode',
  'lyricsSettings.display.miniPlayerDefaultDark': 'Default dark',
  'lyricsSettings.display.miniPlayerDescription': 'Hides the default bottom player bar on the lyrics page and uses a smaller control bar centered at the bottom.',
  'lyricsSettings.display.miniPlayerHint': 'On by default; useful when you want immersive lyrics while keeping quick track changes and seeking.',
  'lyricsSettings.display.miniPlayerOpacity': 'Bottom bar opacity',
  'lyricsSettings.display.miniPlayerPalette': 'Mini bottom bar color palette',
  'lyricsSettings.display.preferUtatenKana': 'Prefer UtaTen kana',
  'lyricsSettings.display.preferUtatenKanaDescription': 'Off by default; Japanese lyrics will try UtaTen furigana instead of romanization and fall back automatically when unavailable.',
  'lyricsSettings.display.resetDesktopPosition': 'Reset desktop lyrics position',
  'lyricsSettings.display.resetDesktopPositionHint': 'Move back to bottom center',
  'lyricsSettings.display.showRomanization': 'Show romanization',
  'lyricsSettings.display.showRomanizationDescription': 'Prefer romanization from the lyrics source; otherwise generate it locally for Japanese lyrics.',
  'lyricsSettings.display.showTranslation': 'Show Chinese translation',
  'lyricsSettings.display.showTranslationDescription': 'Prefer Chinese translations from the lyrics source; no extra text is shown when no translation exists.',
  'lyricsSettings.display.title': 'Lyrics Display',
  'lyricsSettings.display.useMiniPlayerColor': 'Use bottom bar color {color}',
  'lyricsSettings.drawer.aria': 'Lyrics settings',
  'lyricsSettings.drawer.close': 'Close lyrics settings',
  'lyricsSettings.drawer.title': 'Lyrics Settings',
  'lyricsSettings.engine.autoMatch': 'Auto match',
  'lyricsSettings.engine.provider': 'Provider',
  'lyricsSettings.engine.threshold': 'Threshold',
  'lyricsSettings.engine.title': 'Lyrics Engine',
  'lyricsSettings.font.applySystem': 'Apply system font',
  'lyricsSettings.font.chooseInstalled': 'Choose installed font',
  'lyricsSettings.font.custom': 'Custom',
  'lyricsSettings.font.desktopOnly': 'Desktop lyrics only',
  'lyricsSettings.font.importDesktop': 'Import desktop lyrics font',
  'lyricsSettings.font.importFile': 'Import font file',
  'lyricsSettings.font.lyricsOnly': 'Lyrics page and lyrics lines only',
  'lyricsSettings.font.restoreDesktopDefault': 'Restore desktop lyrics default font',
  'lyricsSettings.font.restoreLyricsDefault': 'Restore default lyrics font',
  'lyricsSettings.font.system': 'System font',
  'lyricsSettings.fontPicker.aria': 'Choose lyrics font',
  'lyricsSettings.fontPicker.chooseFile': 'Choose font from file',
  'lyricsSettings.fontPicker.close': 'Close lyrics font picker',
  'lyricsSettings.fontPicker.preview': 'Lyrics font preview Aa Hello',
  'lyricsSettings.fontPicker.searchPlaceholder': 'Search installed fonts',
  'lyricsSettings.fontPicker.title': 'Choose Lyrics Font',
  'lyricsSettings.provider.cached': 'Cached lyrics',
  'lyricsSettings.provider.amllTtml': 'AMLL TTML',
  'lyricsSettings.provider.amllTtmlDescription': 'Word-timed TTML library; requires a NetEase ID match and is off by default',
  'lyricsSettings.provider.chineseCatalogDescription': 'Chinese catalog supplement',
  'lyricsSettings.provider.genius': 'Genius',
  'lyricsSettings.provider.kugou': 'KuGou Music',
  'lyricsSettings.provider.kuwo': 'Kuwo Music',
  'lyricsSettings.provider.local': 'Local lyrics',
  'lyricsSettings.provider.lrclib': 'LRCLIB',
  'lyricsSettings.provider.lrclibDescription': 'Open lyrics library',
  'lyricsSettings.provider.manual': 'Manual lyrics',
  'lyricsSettings.provider.musixmatch': 'Musixmatch',
  'lyricsSettings.provider.netease': 'NetEase Cloud Music',
  'lyricsSettings.provider.none': 'No lyrics applied',
  'lyricsSettings.provider.qqmusic': 'QQ Music',
  'lyricsSettings.preview.primary': 'Lyrics preview',
  'lyricsSettings.preview.secondary': 'Secondary lyric line',
  'lyricsSettings.online.autoSearch': 'Auto match lyrics',
  'lyricsSettings.online.autoSearchDescription': 'Local lyrics always take priority; online results are applied automatically only when they reach the threshold.',
  'lyricsSettings.online.autoSaveSidecar': 'Auto-save local lyrics files',
  'lyricsSettings.online.autoSaveSidecarDescription': 'Off by default; online or manually applied lyrics are saved as same-name sidecar files without overwriting existing .lrc / .ttml / .txt files.',
  'lyricsSettings.online.deepSearch': 'Deep priority search',
  'lyricsSettings.online.deepSearchDescription': 'When enabled, online sources search in parallel; the first result that reaches the auto-apply threshold stops the rest and returns immediately.',
  'lyricsSettings.online.enable': 'Enable online lyrics matching',
  'lyricsSettings.online.enableDescription': 'Only title, artist, album, and duration are sent for matching.',
  'lyricsSettings.online.sources': 'Lyrics sources',
  'lyricsSettings.online.sourcesDescription': 'Local lyrics always take priority; unchecked online sources will not participate in automatic matching or rematching.',
  'lyricsSettings.online.title': 'Online Matching',
  'lyricsSettings.status.applied': 'Lyrics applied',
  'lyricsSettings.status.applying': 'Applying',
  'lyricsSettings.status.auto': 'Auto',
  'lyricsSettings.status.markedInstrumental': 'Marked as instrumental',
  'lyricsSettings.status.noCandidates': 'No lyrics candidates found',
  'lyricsSettings.status.noPlayingTrack': 'No track is playing',
  'lyricsSettings.status.normal': 'Normal',
  'lyricsSettings.status.off': 'Off',
  'lyricsSettings.status.on': 'On',
  'lyricsSettings.status.rematchingCandidates': 'Rematching lyrics candidates...',
  'lyricsSettings.status.searchingCandidates': 'Searching lyrics candidates...',
  'lyricsSettings.style.chooseLyricsColor': 'Choose lyrics color',
  'lyricsSettings.style.contextOpacity': 'Context opacity',
  'lyricsSettings.style.fontSize': 'Lyrics font size',
  'lyricsSettings.style.lineMaxChars': 'Characters per line',
  'lyricsSettings.style.lineMaxCharsValue': '{count} chars',
  'lyricsSettings.style.lineSpacing': 'Lyrics line spacing',
  'lyricsSettings.style.lyricsColor': 'Lyrics color',
  'lyricsSettings.style.lyricsColorPalette': 'Lyrics color palette',
  'lyricsSettings.style.lyricsFont': 'Lyrics font',
  'lyricsSettings.style.secondaryFontSize': 'Secondary lyrics font size',
  'lyricsSettings.style.showControls': 'Show lyrics style settings',
  'lyricsSettings.style.showControlsDescription': 'Includes secondary font size, lyrics font size, line spacing, context opacity, and lyrics color.',
  'lyricsSettings.style.useColor': 'Use color {color}',
  'lyricsSettings.timing.defaultOffset': 'Default offset for new lyrics',
  'lyricsSettings.timing.globalOffset': 'Global offset',
  'lyricsSettings.timing.restoreDefaults': 'Restore lyrics defaults',
  'lyricsSettings.timing.restoreDefaultsHint': 'Match threshold 50% / offset 0ms',
  'lyricsSettings.timing.showPerTrackOffset': 'Show this-track offset calibration',
  'lyricsSettings.timing.smartAlignment': 'Smart lyrics alignment',
  'lyricsSettings.timing.smartAlignmentDescription': 'Automatically saves the current track offset at high confidence; abnormal drift only suggests changing sources and can be reverted.',
  'lyricsSettings.timing.timelineCorrection': 'Apply lyrics timeline calibration',
  'lyricsSettings.timing.timelineCorrectionDescription': 'Global offset affects every song; adjust this-track offset from the lyrics page calibration bar, where it is remembered per track.',
  'lyricsSettings.timing.title': 'Matching And Offset',
  'lyricsSettings.wordHighlight.clarity': 'Word highlight clarity',
  'lyricsSettings.wordHighlight.clarityDescription': 'Default is "Normal"; higher keeps the unsung part of the current word more complete, lower gives a stronger word-by-word progression.',
  'lyricsSettings.wordHighlight.description': 'Only enabled when the lyrics file contains real word timestamps; otherwise line highlighting is used.',
  'lyricsSettings.wordHighlight.title': 'Word-by-word lyrics highlight',
  'route.mvSettings.description': 'MV binding and local matching settings.',
  'route.mvSettings.label': 'MV Settings',
  'mvSettings.action.chooseFile': 'Import local video',
  'mvSettings.action.close': 'Close MV settings',
  'mvSettings.action.collapseNetwork': 'Collapse network sources',
  'mvSettings.action.dragReorder': 'Drag to set priority',
  'mvSettings.action.dragSource': 'Drag {provider} to set priority',
  'mvSettings.action.expandNetwork': 'Expand network sources',
  'mvSettings.action.findLocal': 'Find local',
  'mvSettings.action.openExternal': 'Open selected MV externally',
  'mvSettings.action.refresh': 'Refresh',
  'mvSettings.action.removeSelected': 'Remove selected MV',
  'mvSettings.action.searchNetwork': 'Search network MV',
  'mvSettings.aria.candidates': 'MV candidates',
  'mvSettings.aria.drawer': 'MV settings',
  'mvSettings.aria.engineStatus': 'MV engine status',
  'mvSettings.aria.maxQuality': 'Max quality {quality}',
  'mvSettings.aria.maxQualityOptions': 'Max quality options',
  'mvSettings.aria.networkSources': 'Network source priority',
  'mvSettings.aria.selectedQuality': 'Selected MV quality {quality}',
  'mvSettings.aria.selectedQualityOptions': 'Selected MV quality options',
  'mvSettings.badge.credentialsMain': 'Credentials stay in main',
  'mvSettings.badge.proxyOnly': 'Proxy only',
  'mvSettings.binding.selectedMv': 'Selected MV',
  'mvSettings.binding.title': 'MV Source',
  'mvSettings.candidate.external': 'External',
  'mvSettings.candidate.inApp': 'In-app',
  'mvSettings.custom.apply': 'Apply custom MV',
  'mvSettings.custom.description': 'Paste a YouTube or Bilibili video link as the current MV.',
  'mvSettings.custom.directDash': 'Direct stream (DASH)',
  'mvSettings.custom.input': 'Custom MV link',
  'mvSettings.custom.placeholder': 'https://youtube.com/watch?v=... or BVxxxxxxxx',
  'mvSettings.custom.playing': 'Now playing: {provider} - {sourceId}',
  'mvSettings.custom.title': 'Custom MV',
  'mvSettings.custom.videoTitle': 'Video title: {title}',
  'mvSettings.engine.mvTitle': 'MV Title',
  'mvSettings.engine.network': 'Network',
  'mvSettings.engine.quality': 'Quality',
  'mvSettings.engine.selected': 'Selected',
  'mvSettings.engine.title': 'MV Engine',
  'mvSettings.error.noActiveTrackBinding': 'No active library track for MV binding',
  'mvSettings.error.noActiveTrackMatching': 'No active library track for MV matching',
  'mvSettings.error.noActiveTrackNetworkSearch': 'No active library track for network MV search',
  'mvSettings.error.databaseUnavailable': 'MV database is temporarily unavailable. Repair the database in Library Recovery first.',
  'mvSettings.error.noLocalCandidates': 'No local MV candidates found',
  'mvSettings.error.noNetworkCandidates': 'No network MV candidates found',
  'mvSettings.general.enabled': 'Enable MV',
  'mvSettings.immersive.blur': 'Glass blur',
  'mvSettings.immersive.autoScale': 'Auto scale',
  'mvSettings.immersive.autoScaleDescription': 'Automatically compensates for the MV aspect ratio to reduce background black bars.',
  'mvSettings.immersive.brightness': 'Background brightness',
  'mvSettings.immersive.description': 'Use the current MV as the lyrics page background.',
  'mvSettings.immersive.dragHint': 'Drag empty space on the lyrics page to fine tune it.',
  'mvSettings.immersive.hideLyrics': 'Hide lyrics in MV view',
  'mvSettings.immersive.hideLyricsDescription': 'When enabled, lyrics text is hidden while the MV view is open. Off by default.',
  'mvSettings.immersive.lyricsReadability': 'Lyrics readability boost',
  'mvSettings.immersive.lyricsReadabilityDescription': 'Adds outline and shadow to lyrics over immersive MV.',
  'mvSettings.immersive.overlay': 'Dark overlay',
  'mvSettings.immersive.overlayHint': 'Lower keeps the MV closer to the original; higher keeps lyrics clearer.',
  'mvSettings.immersive.positionX': 'Horizontal position',
  'mvSettings.immersive.positionY': 'Vertical position',
  'mvSettings.immersive.reset': 'Reset immersive background',
  'mvSettings.immersive.title': 'Immersive MV background',
  'mvSettings.immersive.tuning': 'Immersive background tuning',
  'mvSettings.immersive.visualHint': 'Tune how the immersive background looks.',
  'mvSettings.immersive.zoom': 'Background zoom',
  'mvSettings.network.autoApply': 'Auto search network MV',
  'mvSettings.network.autoApplyThreshold': 'Auto-apply match',
  'mvSettings.network.autoApplyThresholdDescription': 'Only apply candidates at {threshold} or higher.',
  'mvSettings.network.autoPreload': 'Preload MV',
  'mvSettings.network.autoPreloadDescription': 'When enabled, playing a song will look up and prepare its MV ahead of time.',
  'mvSettings.network.diagnosticsReport': 'MV diagnostics report',
  'mvSettings.network.diagnosticsReportDescription': 'Off by default; when enabled, the MV page shows a copyable local report if no video is visible.',
  'mvSettings.network.maxQuality': 'Max quality',
  'mvSettings.network.preferHighestViewCount': 'Match by views',
  'mvSettings.network.preferHighestViewCountDescription': 'When enabled, auto search uses only the song and artist, then prefers the playable MV with the highest view count.',
  'mvSettings.network.replayAudioOnChange': 'Replay music after switching MV',
  'mvSettings.network.replayAudioOnChangeDescription': 'When enabled, manually selecting or binding a new MV replays the current song so the MV applies immediately.',
  'mvSettings.network.restartAudioOnLoad': 'Follow music progress',
  'mvSettings.network.restartAudioOnLoadDescription': 'When enabled, the MV video time is continuously corrected. Audio is not seeked or restarted, and lyrics sync offsets do not affect the MV.',
  'mvSettings.network.syncMode': 'Sync mode',
  'mvSettings.network.syncModeDescription': 'Small drift is corrected by video speed; large drift seeks the video.',
  'mvSettings.network.syncMode.stable': 'Stable',
  'mvSettings.network.syncMode.balanced': 'Balanced',
  'mvSettings.network.syncMode.precise': 'Precise',
  'mvSettings.network.title': 'Network Sources',
  'mvSettings.offset.aria': 'MV sync offset',
  'mvSettings.offset.description': 'Positive values advance the MV; negative values delay it. Saved only for this song MV.',
  'mvSettings.offset.earlier': 'MV earlier {value}',
  'mvSettings.offset.earlierShort': 'Earlier {value}',
  'mvSettings.offset.input': 'Offset seconds',
  'mvSettings.offset.later': 'MV later {value}',
  'mvSettings.offset.laterShort': 'Later {value}',
  'mvSettings.offset.replay': 'Replay',
  'mvSettings.offset.replayTitle': 'Replay the current song and sync the video from the MV start point',
  'mvSettings.offset.reset': 'Reset MV offset',
  'mvSettings.offset.resetShort': 'Reset',
  'mvSettings.offset.slider': 'MV sync offset slider',
  'mvSettings.offset.startDescription': 'Enter the start second in the video, up to 600s. This song aligns from there.',
  'mvSettings.offset.startInput': 'MV start second',
  'mvSettings.offset.startTitle': 'Start video from',
  'mvSettings.offset.step': 'Adjustment step',
  'mvSettings.offset.title': 'MV sync calibration',
  'mvSettings.provider.local': 'Local',
  'mvSettings.quality.max': 'Max',
  'mvSettings.search.input': 'MV search keywords',
  'mvSettings.search.placeholder': 'Enter MV search keywords',
  'mvSettings.search.useCurrentSong': 'Search with current song and artist',
  'mvSettings.status.auto': 'Auto',
  'mvSettings.status.noActiveTrack': 'No active track',
  'mvSettings.status.none': 'None',
  'mvSettings.status.off': 'Off',
  'mvSettings.status.on': 'On',
  'mvSettings.title': 'MV Settings',
  'trackMenu.action.addToPlaylist': 'Add to playlist...',
  'trackMenu.action.playNext': 'Play next',
  'trackMenu.action.addToQueue': 'Add to queue',
  'trackMenu.action.like': 'Like',
  'trackMenu.action.unlike': 'Unlike',
  'trackMenu.action.removeFromQueue': 'Remove from playback queue',
  'trackMenu.action.removeFromPlaylist': 'Remove from this playlist',
  'trackMenu.action.openOsuTiming': 'osu! Timing',
  'trackMenu.action.editTags': 'Edit tags',
  'trackMenu.action.reloadEmbeddedTags': 'Reload embedded tags',
  'trackMenu.action.clearLyricsCache': 'Clear lyrics cache',
  'trackMenu.action.goToAlbum': 'Go to album',
  'trackMenu.action.showInFolder': 'Show in folder',
  'trackMenu.action.copyPath': 'Copy file path',
  'trackMenu.action.openSystem': 'Open with system default app',
  'trackMenu.action.copyNameArtist': 'Copy title and artist',
  'trackMenu.action.copyCover': 'Copy song card image',
  'trackMenu.action.saveCover': 'Save song card image',
  'trackMenu.action.deleteSong': 'Delete song',
  'route.playlists.description': 'User playlists.',
  'route.playlists.label': 'Playlists',
  'playlistsPage.action.importFile': 'Import M3U/M3U8 playlist',
  'playlistsPage.action.newLocal': 'Create local playlist',
  'playlistsPage.daily.subtitle': 'NetEase Cloud account recommendations',
  'playlistsPage.daily.title': 'Daily recommendations',
  'playlistsPage.empty.create': 'Create playlist',
  'playlistsPage.empty.createFirst': 'Create your first local playlist',
  'playlistsPage.empty.local': 'No local playlists yet.',
  'playlistsPage.error.desktopBridgeDailyRecommend': 'Desktop bridge unavailable. Open ECHO Next in Electron to refresh NetEase daily recommendations.',
  'playlistsPage.form.cancel': 'Cancel create',
  'playlistsPage.form.create': 'Create',
  'playlistsPage.form.nameAria': 'Local playlist name',
  'playlistsPage.form.placeholder': 'New local playlist',
  'playlistsPage.importStreaming.add': 'Add playlist',
  'playlistsPage.importStreaming.adding': 'Adding',
  'playlistsPage.importStreaming.placeholder': 'Paste a NetEase / QQ Music / KuGou / Spotify playlist link',
  'playlistsPage.importStreaming.title': 'Add streaming playlist',
  'playlistsPage.prompt.newLocalName': 'New local playlist name',
  'playlistsPage.status.createdLocal': 'Local playlist created',
  'playlistsPage.status.importedStreamingPlaylist': 'Added playlist: {name}, {count} tracks',
  'playlistsPage.status.importingStreamingPlaylist': 'Adding streaming playlist...',
  'playlistsPage.status.loading': 'Loading playlists...',
  'playlistsPage.status.refreshedDaily': 'Daily recommendations refreshed: {count} tracks',
  'playlistsPage.status.refreshingDaily': 'Refreshing NetEase daily recommendations...',
  'playlistsPage.view.aria': 'Playlist view',
  'playlistsPage.view.local': 'Local playlists',
  'playlistsPage.view.streamingFavorites': 'Streaming favorites',
  'route.plugins.description': 'Local editable plugins.',
  'route.plugins.label': 'Plugins',
  'route.queue.description': 'Playback queue.',
  'route.queue.label': 'Queue',
  'queue.action.clear': 'Clear queue',
  'queue.action.dragLabel': 'Drag {title}',
  'queue.action.dragTitle': 'Drag to reorder',
  'queue.action.generateFromHistory': 'Generate from history',
  'queue.action.generateRandom': 'Generate random queue',
  'queue.action.generatingHistory': 'Generating',
  'queue.action.generatingRandom': 'Generating',
  'queue.action.autoFill': 'Auto-fill queue',
  'queue.action.like': 'Like',
  'queue.action.more': 'More',
  'queue.action.openFolder': 'Open containing folder',
  'queue.action.play': 'Play {title}',
  'queue.action.playNext': 'Play next {title}',
  'queue.action.remove': 'Remove {title}',
  'queue.action.shuffle': 'Shuffle',
  'queue.count': '{count} tracks',
  'queue.empty.description': 'Play a song, add to queue, or choose play next to fill this list.',
  'queue.empty.title': 'No upcoming tracks',
  'queue.error.desktopBridge': 'Desktop bridge unavailable. Open ECHO Next desktop to read the library.',
  'queue.error.noHistoryTracks': 'No playback history is available to build a queue yet.',
  'queue.error.noRandomTracks': 'Your library does not have any tracks for a random queue yet.',
  'queue.header.kicker': 'Playback Queue',
  'queue.header.title': 'Queue',
  'queue.historySource': 'Frequent history',
  'queue.now.actions': 'Current track actions',
  'queue.now.emptyDescription': 'Start a track or album to build the queue.',
  'queue.now.emptyTitle': 'Nothing is playing',
  'queue.now.kicker': 'Now Playing',
  'queue.now.quality': 'Audio quality',
  'queue.now.sourceFallback': 'Queue',
  'queue.now.waitingAudio': 'Waiting for audio info',
  'queue.quality.unknown': 'Unknown',
  'queue.randomSource': 'Random queue',
  'queue.repeat.all': 'Queue',
  'queue.repeat.mode': 'Repeat mode',
  'queue.repeat.off': 'Off',
  'queue.repeat.one': 'One',
  'queue.tools': 'Queue tools',
  'queue.upNext.kicker': 'Up Next',
  'queue.upNext.title': 'Upcoming tracks',
  'queue.upNext.waitingCount': '{count} waiting',
  'queue.unknownAlbum': 'Unknown album',
  'queue.unknownArtist': 'Unknown artist',
  'route.remote.description': 'Remote sources.',
  'route.remote.label': 'Cloud / Remote',
  'route.settings.description': 'Application settings.',
  'route.settings.label': 'Settings',
  'route.songs.description': 'Local library song list.',
  'route.songs.label': 'Songs',
  'songs.action.clearList': 'Clear list',
  'songs.action.openRecovery': 'Open recovery assistant',
  'songs.duplicatesOnly': 'Duplicates only',
  'songs.error.albumNotFound': 'Album not found: {album}',
  'songs.error.artistNotFound': 'Artist not found: {artist}',
  'songs.error.desktopBridgeClear': 'Desktop bridge unavailable. Open ECHO Next in Electron to clear the library list.',
  'songs.error.desktopBridgeFileActions': 'Desktop bridge unavailable. Open ECHO Next in Electron to use file actions.',
  'songs.error.desktopBridgeLyricsCache': 'Desktop bridge unavailable. Open ECHO Next in Electron to clear lyrics cache.',
  'songs.error.desktopBridgeMaintain': 'Desktop bridge unavailable. Open ECHO Next in Electron to maintain the library.',
  'songs.error.desktopBridgePlay': 'Desktop bridge unavailable. Open ECHO Next in Electron to play local files.',
  'songs.error.desktopBridgePlaylists': 'Desktop bridge unavailable. Open ECHO Next in Electron to use playlists.',
  'songs.error.desktopBridgeRead': 'Desktop bridge unavailable. Open ECHO Next in Electron to read the library.',
  'songs.error.desktopBridgeVersions': 'Desktop bridge unavailable. Open ECHO Next in Electron to inspect duplicate versions.',
  'songs.importHint': 'You can also drag music files or folders directly into the window. Supports MP3, FLAC, WAV, ALAC, AAC, OPUS, OGG, APE, WV, DSF, DFF, and CUE, with more formats detected automatically.',
  'songs.queueSource.local': 'Song list',
  'songs.queueSource.remote': 'Cloud songs',
  'songs.search.placeholder': 'Search songs / artists / albums...',
  'songs.sort.album': 'By album',
  'songs.sort.artist': 'By artist',
  'songs.sort.artistAlbum': 'By artist / album',
  'songs.sort.createdAsc': 'Created time (ascending)',
  'songs.sort.createdDesc': 'Created time (descending)',
  'songs.sort.default': 'Default sort',
  'songs.sort.durationAsc': 'Duration (short to long)',
  'songs.sort.durationDesc': 'Duration (long to short)',
  'songs.sort.fileModifiedAsc': 'File modified (old to new)',
  'songs.sort.fileModifiedDesc': 'File modified (new to old)',
  'songs.sort.frequent': 'Most played',
  'songs.sort.menuAria': 'Song sort',
  'songs.sort.qualityAsc': 'Quality/size (small to large)',
  'songs.sort.qualityDesc': 'Quality/size (large to small)',
  'songs.sort.random': 'Random sort',
  'songs.sort.recent': 'Recently updated',
  'songs.sort.titleAsc': 'Song title (A-Z)',
  'songs.sort.titleDesc': 'Song title (Z-A)',
  'songs.trackList.aria': 'Song list',
  'songs.trackList.empty': 'No songs to display. After importing a music folder, your library list will appear here.',
  'route.streaming.description': 'Streaming music sources.',
  'route.streaming.label': 'Streaming',
  'streaming.empty.notFoundAlbum': 'No matching albums were found.',
  'streaming.empty.notFoundArtist': 'No matching artists were found.',
  'streaming.empty.notFoundPlaylist': 'No matching playlists were found.',
  'streaming.empty.notFoundTrack': 'No matching streaming tracks were found.',
  'streaming.empty.searchHint': 'Enter keywords to start searching. Real audio URLs are resolved only during playback, and the queue does not store temporary URLs.',
  'streaming.hero.currentProvider': 'Current source',
  'streaming.hero.description': 'Search online catalogs and resolve audio URLs temporarily before playback.',
  'streaming.hero.meterAria': 'Current streaming status',
  'streaming.hero.preparingSearch': 'Preparing search',
  'streaming.hero.title': 'Streaming music',
  'streaming.provider.available': 'Available',
  'streaming.provider.disabled': 'Disabled',
  'streaming.provider.loggedIn': 'Signed in as {name}',
  'streaming.provider.notLoggedIn': 'Not signed in',
  'streaming.providers.aria': 'Streaming platforms',
  'streaming.quality.high': 'High',
  'streaming.quality.highDescription': 'Prefer 320kbps',
  'streaming.quality.hires': 'Hi-Res',
  'streaming.quality.hiresDescription': 'Enable when the provider supports it',
  'streaming.quality.label': 'Quality',
  'streaming.quality.lossless': 'Lossless',
  'streaming.quality.losslessDescription': 'Prefer FLAC',
  'streaming.quality.max': 'Max',
  'streaming.quality.maxDescription': 'Default highest quality',
  'streaming.quality.menuAria': 'Quality',
  'streaming.quality.standard': 'Standard',
  'streaming.quality.standardDescription': 'Better compatibility',
  'streaming.quality.switchFailed': 'Failed to switch quality',
  'streaming.quality.switched': 'Switched quality: {quality}',
  'streaming.result.count': '{count} results',
  'streaming.result.searching': 'Searching',
  'streaming.result.searchingEllipsis': 'Searching...',
  'streaming.search.placeholder': 'Search songs, artists, albums',
  'streaming.tab.album': 'Albums',
  'streaming.tab.artist': 'Artists',
  'streaming.tab.playlist': 'Playlists',
  'streaming.tab.track': 'Tracks',
  'streaming.tabs.aria': 'Result types',
  'settings.header.searchPlaceholder': 'Search settings...',
  'settings.nav.general.label': 'General',
  'settings.nav.general.description': 'Language, window, and basic behavior',
  'settings.nav.playback.label': 'Playback',
  'settings.nav.playback.description': 'Output, buffering, and playback controls',
  'settings.nav.integrations.label': 'Integrations',
  'settings.nav.integrations.description': 'Accounts, Discord, external devices',
  'settings.nav.remote.label': 'Cloud / Remote',
  'settings.nav.remote.description': 'NAS, WebDAV, Subsonic',
  'settings.nav.eq.label': 'EQ',
  'settings.nav.eq.description': 'Equalizer and output safety',
  'settings.nav.shortcuts.label': 'Shortcuts',
  'settings.nav.shortcuts.description': 'Local shortcuts, global shortcuts, playback controls',
  'settings.eq.action.addFilter': 'Add filter',
  'settings.eq.action.autoPreamp': 'Auto {value}',
  'settings.eq.action.bypass': 'Bypass',
  'settings.eq.action.delete': 'Delete',
  'settings.eq.action.deleteFilter': 'Delete filter',
  'settings.eq.action.duplicatePreset': 'Duplicate current',
  'settings.eq.action.exportApoGraphicEqPreset': 'Export GraphicEQ',
  'settings.eq.action.exportApoPreset': 'Export APO',
  'settings.eq.action.freqDown': 'Freq -',
  'settings.eq.action.freqFineDown': 'Fine -',
  'settings.eq.action.freqFineUp': 'Fine +',
  'settings.eq.action.freqUp': 'Freq +',
  'settings.eq.action.holdBypass': 'Hold to Bypass EQ',
  'settings.eq.action.holdOriginal': 'Hold original',
  'settings.eq.action.hideAdvanced': 'Hide PEQ console',
  'settings.eq.action.importPreset': 'Import preset / APO',
  'settings.eq.action.pasteApoPreset': 'Paste APO',
  'settings.eq.action.applyA': 'Apply A',
  'settings.eq.action.applyB': 'Apply B',
  'settings.eq.action.applySafePreamp': 'Apply safe preamp',
  'settings.eq.action.applyProfile': 'Apply profile',
  'settings.eq.action.bindProfile': 'Bind current output',
  'settings.eq.action.deleteProfile': 'Delete profile',
  'settings.eq.action.overwrite': 'Overwrite',
  'settings.eq.action.redo': 'Redo',
  'settings.eq.action.resetBand': 'Reset {frequency}',
  'settings.eq.action.resetAllGains': 'Reset all gains',
  'settings.eq.action.resetChannelBalance': 'Reset channel balance',
  'settings.eq.action.resetDelaysOnly': 'Reset delays',
  'settings.eq.action.resetEq': 'Reset EQ',
  'settings.eq.action.resetFrequencies': 'Standard bands',
  'settings.eq.action.resetMonitorTools': 'Reset monitor tools',
  'settings.eq.action.resetSelected': 'Reset selected',
  'settings.eq.action.resetTrimsOnly': 'Reset trims only',
  'settings.eq.action.revertUserPreset': 'Revert user preset',
  'settings.eq.action.save': 'Save',
  'settings.eq.action.saveAs': 'Save as',
  'settings.eq.action.saveProfile': 'Save profile',
  'settings.eq.action.showAdvanced': 'PEQ Console',
  'settings.eq.action.storeA': 'Store A',
  'settings.eq.action.storeB': 'Store B',
  'settings.eq.action.toggleBypassOff': 'Disable bypass',
  'settings.eq.action.toggleBypassOn': 'Toggle Bypass',
  'settings.eq.action.undo': 'Undo',
  'settings.eq.action.unlockFrequency': 'Unlock frequency',
  'settings.eq.ab.emptySlot': 'Empty slot',
  'settings.eq.ab.loudnessMatched': 'Loudness matched',
  'settings.eq.ab.summary': '{preset} / peak {peak} / out {output} / preamp {preamp}',
  'settings.eq.ab.title': 'A/B Compare',
  'settings.eq.autoGain.adjustment': 'Auto {value}',
  'settings.eq.autoGain.status': 'Status',
  'settings.eq.autoGain.status.clipping': 'Clipping',
  'settings.eq.autoGain.status.holding': 'Holding',
  'settings.eq.autoGain.status.idle': 'Idle',
  'settings.eq.autoGain.status.recovering': 'Recovering',
  'settings.eq.autoGain.status.reducing': 'Reducing',
  'settings.eq.autoGain.toggle': 'Auto Gain',
  'settings.eq.room.active': 'Active',
  'settings.eq.room.channelMode': 'Channels',
  'settings.eq.room.clear': 'Clear',
  'settings.eq.room.disable': 'Disable FIR',
  'settings.eq.room.empty': 'No IR',
  'settings.eq.room.enable': 'Enable FIR',
  'settings.eq.room.error': 'Error',
  'settings.eq.room.error.invalidImpulse': 'Invalid IR',
  'settings.eq.room.error.invalidWav': 'Invalid WAV',
  'settings.eq.room.error.missingFile': 'Missing IR file',
  'settings.eq.room.error.missingIr': 'No IR loaded',
  'settings.eq.room.error.tooLong': 'IR too long',
  'settings.eq.room.import': 'Import IR',
  'settings.eq.room.ir': 'IR',
  'settings.eq.room.loaded': 'Loaded',
  'settings.eq.room.sampleRate': 'Sample rate',
  'settings.eq.room.short': 'FIR',
  'settings.eq.room.tapCount': 'Taps',
  'settings.eq.room.title': 'Room Correction',
  'settings.eq.room.trim': 'Trim',
  'settings.eq.analyzer.overlayAria': 'EQ realtime spectrum overlay',
  'settings.eq.analyzer.input': 'Input',
  'settings.eq.analyzer.mode': 'Analyzer mode',
  'settings.eq.analyzer.postEq': 'Post EQ',
  'settings.eq.analyzer.status': 'Status',
  'settings.eq.analyzer.status.live': 'Live',
  'settings.eq.analyzer.status.noSignal': 'No signal',
  'settings.eq.analyzer.status.off': 'Off',
  'settings.eq.analyzer.status.priming': 'Priming',
  'settings.eq.analyzer.toggle': 'Analyzer',
  'settings.eq.band.fallback': 'Band',
  'settings.eq.band.frequency': 'Frequency',
  'settings.eq.band.frequencyStepper': 'Frequency stepper',
  'settings.eq.band.frequencySnapped': 'Snapped to standard bands',
  'settings.eq.band.frequencyUnlocked': 'Free frequency',
  'settings.eq.band.gain': 'Gain',
  'settings.eq.band.gainStepper': 'Gain stepper',
  'settings.eq.band.gainFixed': 'Gain is fixed for this type',
  'settings.eq.band.qPresets': 'Q presets',
  'settings.eq.band.qPresetWide': 'Wide',
  'settings.eq.band.qPresetNormal': 'Normal',
  'settings.eq.band.qPresetNarrow': 'Narrow',
  'settings.eq.band.bypassed': 'Bypassed',
  'settings.eq.band.console': 'Selected band console',
  'settings.eq.band.enabled': 'Band enabled',
  'settings.eq.band.enabledShort': 'enabled',
  'settings.eq.band.filters': 'filters',
  'settings.eq.band.filterStack': 'APO Filter Stack',
  'settings.eq.band.filterType': 'Type',
  'settings.eq.band.inspector': 'Selected band',
  'settings.eq.band.matrix': 'PEQ Band Matrix',
  'settings.eq.band.modeFree': 'Free frequency',
  'settings.eq.band.modeStandard': 'Standard bands',
  'settings.eq.band.q': 'Q',
  'settings.eq.band.readoutsAria': '31-band EQ draggable band readouts',
  'settings.eq.bitPerfect.channelDisabled': 'DSP active: bit-perfect disabled.',
  'settings.eq.bitPerfect.disabled': 'DSP active: bit-perfect disabled{reason}.',
  'settings.eq.bitPerfect.readyPath': 'Bit-perfect path can be preserved.',
  'settings.eq.bitPerfect.sourceBoth': 'EQ + Channel Balance',
  'settings.eq.bitPerfect.sourceChannel': 'Channel Balance',
  'settings.eq.bitPerfect.sourceEq': 'EQ',
  'settings.eq.bitPerfect.sourceRoom': 'Room Correction',
  'settings.eq.channel.active': 'Active',
  'settings.eq.channel.balance': 'Balance',
  'settings.eq.channel.bypassed': 'Bypassed',
  'settings.eq.channel.calibrationMode': 'Calibration mode',
  'settings.eq.channel.center': 'Center',
  'settings.eq.channel.constantPower': 'Constant Power',
  'settings.eq.channel.description': 'Balance shifts left/right. L/R Gain corrects level. L/R Delay aligns arrival time. Mono Sum and Invert are monitor checks.',
  'settings.eq.channel.dsp': 'DSP',
  'settings.eq.channel.effectiveLeft': 'Effective L',
  'settings.eq.channel.effectiveRight': 'Effective R',
  'settings.eq.channel.group.balance': 'Balance',
  'settings.eq.channel.group.gainTrim': 'Gain Trim',
  'settings.eq.channel.group.monitorTools': 'Monitor Tools',
  'settings.eq.channel.group.phaseTools': 'Phase Tools',
  'settings.eq.channel.group.timing': 'Timing',
  'settings.eq.channel.invertLeft': 'Invert Left',
  'settings.eq.channel.invertRight': 'Invert Right',
  'settings.eq.channel.leftDelay': 'Left Delay',
  'settings.eq.channel.leftGain': 'Left Gain',
  'settings.eq.channel.leftTotal': 'Left total',
  'settings.eq.channel.mono.left': 'Left',
  'settings.eq.channel.mono.off': 'Off',
  'settings.eq.channel.mono.right': 'Right',
  'settings.eq.channel.mono.sum': 'Sum',
  'settings.eq.channel.monoMode': 'Mono mode',
  'settings.eq.channel.quick.leftSolo': 'Left Solo',
  'settings.eq.channel.quick.monoCheck': 'Mono Check',
  'settings.eq.channel.quick.phaseCheck': 'Phase Check',
  'settings.eq.channel.quick.rightSolo': 'Right Solo',
  'settings.eq.channel.quick.swapCheck': 'Swap Check',
  'settings.eq.channel.quickTools': 'Quick monitor tools',
  'settings.eq.channel.rightDelay': 'Right Delay',
  'settings.eq.channel.rightGain': 'Right Gain',
  'settings.eq.channel.rightTotal': 'Right total',
  'settings.eq.channel.swap': 'Swap L/R',
  'settings.eq.channel.title': 'Channel Balance',
  'settings.eq.channel.wizard.apply': 'Apply measurement',
  'settings.eq.channel.wizard.clear': 'Clear measurement',
  'settings.eq.channel.wizard.empty': 'Waiting',
  'settings.eq.channel.wizard.imageLeft': 'Image pulls left',
  'settings.eq.channel.wizard.imageRight': 'Image pulls right',
  'settings.eq.channel.wizard.leftDistance': 'Left distance',
  'settings.eq.channel.wizard.leftLouder': 'Left is louder',
  'settings.eq.channel.wizard.leftSpl': 'Left SPL',
  'settings.eq.channel.wizard.monitor': 'Spatial calibration monitor',
  'settings.eq.channel.wizard.nudge': 'Spatial calibration nudges',
  'settings.eq.channel.wizard.previewCenter': 'Center check',
  'settings.eq.channel.wizard.previewLeft': 'Left check',
  'settings.eq.channel.wizard.previewRight': 'Right check',
  'settings.eq.channel.wizard.ready': 'Ready',
  'settings.eq.channel.wizard.rightDistance': 'Right distance',
  'settings.eq.channel.wizard.rightLouder': 'Right is louder',
  'settings.eq.channel.wizard.rightSpl': 'Right SPL',
  'settings.eq.channel.wizard.title': 'Spatial Calibration Wizard',
  'settings.eq.curve.aria': 'Draggable 31-band EQ frequency response',
  'settings.eq.curve.dragBand': 'Drag {frequency} EQ band',
  'settings.eq.curve.fineEdit': 'Shift fine edit',
  'settings.eq.curve.freeFrequency': 'Free frequency',
  'settings.eq.curve.snapped': 'Snapped',
  'settings.eq.error.bridgeChannelBalance': 'Desktop bridge unavailable. Open ECHO Next in Electron to control channel balance.',
  'settings.eq.error.bridgeControlEq': 'Desktop bridge unavailable. Open ECHO Next in Electron to control EQ.',
  'settings.eq.error.bridgeDeletePreset': 'Desktop bridge unavailable. Open ECHO Next in Electron to delete EQ presets.',
  'settings.eq.error.bridgeSavePreset': 'Desktop bridge unavailable. Open ECHO Next in Electron to save EQ presets.',
  'settings.eq.error.presetName': 'Enter a preset name before saving.',
  'settings.eq.error.profileName': 'Enter a profile name before saving.',
  'settings.eq.error.profileTarget': 'Select a profile first.',
  'settings.eq.export.successApo': 'Exported Equalizer APO config to {path}',
  'settings.eq.export.successGraphicEq': 'Exported GraphicEQ config to {path}',
  'settings.eq.export.successPreset': 'Exported EQ preset to {path}',
  'settings.eq.import.filters': 'Filter',
  'settings.eq.import.filtersValue': '{count} imported / {skipped} skipped',
  'settings.eq.import.filterPreview': 'Filter details',
  'settings.eq.import.filterEnabledAria': 'Imported filter {index} enabled',
  'settings.eq.import.filterFrequencyAria': 'Imported filter {index} frequency',
  'settings.eq.import.filterGainAria': 'Imported filter {index} gain',
  'settings.eq.import.filterQAria': 'Imported filter {index} Q',
  'settings.eq.import.filterTypeAria': 'Imported filter {index} type',
  'settings.eq.import.estimatedPeak': 'Estimated peak',
  'settings.eq.import.graphicEq': 'GraphicEQ points',
  'settings.eq.import.includes': 'Include files',
  'settings.eq.import.includesValue': '{count} expanded / {skipped} skipped',
  'settings.eq.import.maxBoost': 'Max boost',
  'settings.eq.import.maxCut': 'Max cut',
  'settings.eq.import.apoDirectives': 'APO directives',
  'settings.eq.import.apoDirectiveDetails': 'Directive details',
  'settings.eq.import.apoDirectivesValue': '{count} recognized / {skipped} channel filters skipped',
  'settings.eq.import.bandwidthFilters': 'BW conversion',
  'settings.eq.import.bandwidthFiltersValue': '{count} converted to Q',
  'settings.eq.import.compatibility': 'Compatibility',
  'settings.eq.import.compatibility.adjusted': 'Converted',
  'settings.eq.import.compatibility.clean': 'Full import',
  'settings.eq.import.compatibility.partial': 'Partial import',
  'settings.eq.import.moreFilters': '{count} more filters hidden',
  'settings.eq.import.noFilters': 'No active filters to show.',
  'settings.eq.import.preamp': 'Preamp',
  'settings.eq.import.preampAria': 'Imported preset preamp',
  'settings.eq.import.safePreamp': 'Safe preamp',
  'settings.eq.import.safetyDetail': 'Estimated from the imported filters. Reserve headroom before applying when needed.',
  'settings.eq.import.safetyNeedsHeadroom': 'Needs headroom',
  'settings.eq.import.safetyOk': 'Headroom looks safe',
  'settings.eq.import.safetyTitle': 'Import safety',
  'settings.eq.import.audition': 'Audition import',
  'settings.eq.import.auditionPresetName': 'Audition {name}',
  'settings.eq.import.restoreAudition': 'Restore current',
  'settings.eq.import.clearPaste': 'Clear',
  'settings.eq.import.applyPreview': 'Apply import',
  'settings.eq.import.cancelPreview': 'Cancel import',
  'settings.eq.import.pasteDefaultName': 'Pasted APO',
  'settings.eq.import.pasteEmpty': 'Paste an Equalizer APO config first.',
  'settings.eq.import.pasteFileName': 'Pasted text',
  'settings.eq.import.pasteIncludeWarning': 'Pasted imports cannot read Include files. Use file import when Include expansion is needed.',
  'settings.eq.import.pasteTitle': 'APO text',
  'settings.eq.import.previewPaste': 'Preview APO',
  'settings.eq.import.previewTitle': 'Import preview',
  'settings.eq.import.reportTitle': 'Import complete',
  'settings.eq.import.source': 'Source',
  'settings.eq.import.sourceApo': 'Equalizer APO',
  'settings.eq.import.sourceEcho': 'ECHO JSON',
  'settings.eq.import.updateAudition': 'Update audition',
  'settings.eq.import.useSafePreamp': 'Use safe preamp',
  'settings.eq.filter.highShelf': 'High shelf',
  'settings.eq.filter.highPass': 'High pass',
  'settings.eq.filter.lowShelf': 'Low shelf',
  'settings.eq.filter.lowPass': 'Low pass',
  'settings.eq.filter.notch': 'Notch',
  'settings.eq.filter.peaking': 'Peaking',
  'settings.eq.headphoneCorrection.ab': 'Headphone correction A/B',
  'settings.eq.headphoneCorrection.compareCorrected': 'Corrected',
  'settings.eq.headphoneCorrection.compareOriginal': 'Compare original',
  'settings.eq.headphoneCorrection.convert': 'Convert to custom EQ',
  'settings.eq.headphoneCorrection.customName': 'Custom EQ - {name}',
  'settings.eq.headphoneCorrection.lockAria': 'Headphone correction EQ lock',
  'settings.eq.headphoneCorrection.lockDetail': '{name} is managed by headphone correction. Convert to a custom EQ before editing parameters.',
  'settings.eq.headphoneCorrection.lockedError': 'This OPRA preset is managed by headphone correction. Convert it to a custom EQ before editing parameters.',
  'settings.eq.headphoneCorrection.managed': 'Managed by headphone correction',
  'settings.eq.level.clips': 'Clips {count}',
  'settings.eq.level.estimatedOutputPeak': 'Est. output peak',
  'settings.eq.level.headroom': 'Headroom',
  'settings.eq.level.inputPeak': 'Input peak',
  'settings.eq.level.inputRms': 'Input RMS',
  'settings.eq.level.sourceEstimate': 'pre-native + DSP estimate',
  'settings.eq.preamp.aria': 'EQ preamp',
  'settings.eq.preamp.inputSafety': 'Headroom Management',
  'settings.eq.preamp.maxBoost': 'Max boost',
  'settings.eq.preamp.metricsAria': 'Headroom safety metrics',
  'settings.eq.preamp.recommended': 'Recommended',
  'settings.eq.preamp.safeHeadroom': 'Safe Headroom',
  'settings.eq.signal.armed': 'Armed',
  'settings.eq.signal.bitPerfectOutput': 'Bit-perfect path',
  'settings.eq.signal.dspActive': 'DSP signal path active',
  'settings.eq.signal.dspOutput': 'DSP output',
  'settings.eq.signal.input': 'Input',
  'settings.eq.signal.limiter': 'Guard',
  'settings.eq.signal.output': 'Output',
  'settings.eq.signal.peq': 'PEQ',
  'settings.eq.signal.preamp': 'Preamp',
  'settings.eq.signal.protecting': 'Protecting',
  'settings.eq.signal.title': 'Signal Path',
  'settings.eq.simpleAction.customPresetName': 'My EQ Tone',
  'settings.eq.simpleAction.lastTweak': 'Last tweak',
  'settings.eq.simpleAction.nextVibe': 'Next vibe',
  'settings.eq.simpleAction.nextVibeDetail': 'Explore',
  'settings.eq.simpleAction.savedPresetName': '{name} {amount}%',
  'settings.eq.simpleAction.saveVibe': 'Save vibe',
  'settings.eq.simpleAction.saveVibeDetail': 'Save current',
  'settings.eq.simpleInsight.amount': 'Amount',
  'settings.eq.simpleInsight.aria': 'Simple current vibe summary',
  'settings.eq.simpleInsight.custom': 'Manual vibe',
  'settings.eq.simpleInsight.mainChange': 'Main change',
  'settings.eq.simpleInsight.ready': 'Ready',
  'settings.eq.simpleInsight.vibe': 'Current vibe',
  'settings.eq.simpleSafety.action': 'Make safe',
  'settings.eq.simpleSafety.aria': 'Simple safe headroom',
  'settings.eq.simpleSafety.risk': 'Needs headroom',
  'settings.eq.simpleSafety.riskDetail': 'Peak {peak} / suggested {preamp}',
  'settings.eq.simpleSafety.safe': 'Headroom ready',
  'settings.eq.simpleSafety.safeDetail': 'Peak {peak} / preamp {preamp}',
  'settings.eq.comfort.direct': 'Native direct',
  'settings.eq.comfort.directDetail': 'When DSP is off, volume is not reduced and samples are not changed. Good for hearing the original path.',
  'settings.eq.comfort.risk': 'Watch the level',
  'settings.eq.comfort.riskDetail': 'Potential clipping or protection was detected. Start by reserving -6 dB headroom.',
  'settings.eq.comfort.tuned': 'Sound is being shaped',
  'settings.eq.comfort.tunedDetail': 'Only enabled DSP modules are processed. Turn them off to return to the native playback path.',
  'settings.eq.simpleTone.air': 'Air',
  'settings.eq.simpleTone.airDetail': 'Brighter space',
  'settings.eq.simpleTone.amount': 'Tone amount',
  'settings.eq.simpleTone.amountAria': 'Simple tone amount',
  'settings.eq.simpleTone.aria': 'Simple tone quick tweaks',
  'settings.eq.simpleTone.bass': 'Bass lift',
  'settings.eq.simpleTone.bassDetail': 'Fuller kick',
  'settings.eq.simpleTone.flat': 'Flat reset',
  'settings.eq.simpleTone.flatDetail': 'Back to neutral',
  'settings.eq.simpleTone.less': 'Less',
  'settings.eq.simpleTone.more': 'More',
  'settings.eq.simpleTone.vocal': 'Vocal focus',
  'settings.eq.simpleTone.vocalDetail': 'Clearer lyrics',
  'settings.eq.simpleTone.warm': 'Warmth',
  'settings.eq.simpleTone.warmDetail': 'Softer listen',
  'settings.eq.simpleZone.air': 'Air',
  'settings.eq.simpleZone.airDetail': 'Shine and space',
  'settings.eq.simpleZone.applyAria': 'Apply {zone} tone, current {value}',
  'settings.eq.simpleZone.aria': 'Simple listening zone changes',
  'settings.eq.simpleZone.low': 'Low end',
  'settings.eq.simpleZone.lowDetail': 'Kick and weight',
  'settings.eq.simpleZone.neutral': 'Neutral',
  'settings.eq.simpleZone.vocal': 'Vocal',
  'settings.eq.simpleZone.vocalDetail': 'Lyrics and presence',
  'settings.eq.routing.action.armHeadroom6': 'Arm -6dB Headroom',
  'settings.eq.routing.action.nativeDirect': 'Native Direct',
  'settings.eq.routing.armed': 'Armed',
  'settings.eq.routing.dspPath': 'DSP Path',
  'settings.eq.routing.dspPathDetail': 'Processing is explicit and visible.',
  'settings.eq.routing.headroomActiveDetail': 'Headroom is active in the DSP path.',
  'settings.eq.routing.headroomStandby': 'Headroom Standby',
  'settings.eq.routing.headroomStandbyDetail': 'Will apply only when DSP is enabled.',
  'settings.eq.routing.modules': 'Modules',
  'settings.eq.routing.modulesActiveDetail': 'Every active stage is shown below.',
  'settings.eq.routing.modulesBypassed': 'Bypassed',
  'settings.eq.routing.modulesBypassedDetail': 'EQ / FIR / Balance are off.',
  'settings.eq.routing.nativeBypassComfort': 'DSP bypass keeps playback native-direct, and samples are not changed by the effect chain.',
  'settings.eq.routing.nativeDirect': 'Native Direct',
  'settings.eq.routing.nativeDirectDetail': 'DSP bypass keeps playback untouched.',
  'settings.eq.routing.nativeNoGainDetail': 'No gain reduction on native bypass.',
  'settings.eq.routing.playbackPath': 'Playback Path',
  'settings.eq.routing.protectActive': 'Protect Active',
  'settings.eq.routing.protectActiveDetail': 'Limiter is preventing overload.',
  'settings.eq.routing.safety': 'Safety',
  'settings.eq.headroom.dsp': 'DSP Headroom',
  'settings.eq.headroom.nativeBypassNote': 'Only applies when EQ / FIR / Balance is active, so native bypass stays direct.',
  'settings.eq.headroom.presetsAria': 'DSP Headroom presets',  'settings.eq.profile.bound': '{output} bound to {profile}',
  'settings.eq.profile.empty': 'No profile selected',
  'settings.eq.profile.nameAria': 'EQ profile name',
  'settings.eq.profile.namePlaceholder': 'Save as profile',
  'settings.eq.profile.noOutput': 'Current output',
  'settings.eq.profile.selectorAria': 'EQ profile',
  'settings.eq.profile.title': 'Profiles',
  'settings.eq.profile.unbound': '{output} has no profile binding',
  'settings.eq.preset.approximation': '31-band approximation',
  'settings.eq.preset.builtIn': 'Built-in presets',
  'settings.eq.preset.copyName': 'Copy of {name}',
  'settings.eq.preset.filter.all': 'All',
  'settings.eq.preset.filter.builtIn': 'Built-in',
  'settings.eq.preset.filter.genre': 'Genre',
  'settings.eq.preset.filter.target': 'Target curves',
  'settings.eq.preset.filter.user': 'User',
  'settings.eq.preset.filter.utility': 'Utility',
  'settings.eq.preset.filterAria': 'Preset filter',
  'settings.eq.preset.meta.approximationCaution': 'This is a 31-band graphic EQ approximation, not exact headphone calibration.',
  'settings.eq.preset.meta.genrePurpose': 'Shapes the playback toward a familiar genre voicing.',
  'settings.eq.preset.meta.genreScenario': 'Useful for quick listening by style before device-specific tweaks.',
  'settings.eq.preset.meta.targetPurpose': 'Approximates a common listening target curve.',
  'settings.eq.preset.meta.targetScenario': 'Useful for headphone or near-field target comparisons.',
  'settings.eq.preset.meta.tasteCaution': 'This is a voicing choice, not a calibration result.',
  'settings.eq.preset.meta.type.animeJpop': '樱色电波',
  'settings.eq.preset.meta.type.acousticSilk': '弦木柔光',
  'settings.eq.preset.meta.type.bassBoost': '深海低频',
  'settings.eq.preset.meta.type.bkRoomCurve': '木厅曲线',
  'settings.eq.preset.meta.type.broadcastVoice': '电台近语',
  'settings.eq.preset.meta.type.bluetoothSpeakerCleanup': '蓝牙清场',
  'settings.eq.preset.meta.type.classicSmiley': '晨弧微笑',
  'settings.eq.preset.meta.type.classical': '星厅古典',
  'settings.eq.preset.meta.type.cinemaOrchestra': '银幕纵深',
  'settings.eq.preset.meta.type.cityPop': '霓虹夜航',
  'settings.eq.preset.meta.type.diffuseField': '漫野扩散',
  'settings.eq.preset.meta.type.femaleVocalAir': '清露女声',
  'settings.eq.preset.meta.type.flat': '原音如初',
  'settings.eq.preset.meta.type.harmanInEar': '入耳晨光',
  'settings.eq.preset.meta.type.harmanTarget': '暖场哈曼',
  'settings.eq.preset.meta.type.headphoneNotch': '耳峰细修',
  'settings.eq.preset.meta.type.headphoneWarm': '绒暖耳机',
  'settings.eq.preset.meta.type.liveHouse': '小馆现场',
  'settings.eq.preset.meta.type.lofiDusk': '雨窗低保真',
  'settings.eq.preset.meta.type.loudness': '暮色响度',
  'settings.eq.preset.meta.type.night': '月下轻听',
  'settings.eq.preset.meta.type.pianoRoom': '琴房微光',
  'settings.eq.preset.meta.type.rock': '黑曜摇滚',
  'settings.eq.preset.meta.type.sibilanceTamer': '齿音柔化',
  'settings.eq.preset.meta.type.studioNeutral': '录音室白描',
  'settings.eq.preset.meta.type.subCleanup': '潜波净化',
  'settings.eq.preset.meta.type.subsonicFilter': '暗涌滤波',
  'settings.eq.preset.meta.type.trebleSparkle': '银砂高频',
  'settings.eq.preset.meta.type.vinylWarmth': '黑胶余温',
  'settings.eq.preset.meta.type.vocalClear': '人声如绸',
  'settings.eq.preset.meta.type.vocalDeEss': '雪绒去齿',
  'settings.eq.preset.meta.utilityCaution': 'Utility presets can change monitoring judgment; confirm before saving.',
  'settings.eq.preset.meta.utilityPurpose': 'Supports checks, compensation, or safer monitoring.',
  'settings.eq.preset.meta.utilityScenario': 'Useful for finding issues, reducing fatigue, or quick comparisons.',
  'settings.eq.preset.modified': 'Modified',
  'settings.eq.preset.nameAria': 'Preset name',
  'settings.eq.preset.readonly': 'Built-in presets are read-only.',
  'settings.eq.preset.savePlaceholder': 'Save as user preset',
  'settings.eq.preset.searchAria': 'Search presets',
  'settings.eq.preset.searchPlaceholder': 'Search presets',
  'settings.eq.preset.selectorAria': 'EQ preset',
  'settings.eq.preset.user': 'User presets',
  'settings.eq.state.eqDisabled': 'EQ Disabled',
  'settings.eq.state.eqEnabled': 'EQ Enabled',
  'settings.eq.status.bitPerfect': 'Bit-perfect',
  'settings.eq.status.clippingRisk': 'Clipping Risk',
  'settings.eq.status.eq': 'EQ',
  'settings.eq.status.estimatedPeak': 'Estimated Peak',
  'settings.eq.status.headroom': 'Headroom',
  'settings.eq.status.preamp': 'Preamp',
  'settings.eq.status.preset': 'Preset',
  'settings.eq.status.processor': 'Processor',
  'settings.eq.status.realtimeIir': 'Realtime IIR',
  'settings.eq.status.safe': 'Safe',
  'settings.eq.status.safeHeadroomShort': 'Safe headroom',
  'settings.eq.status.warning': 'Warning',
  'settings.eq.mode.aria': 'EQ view mode',
  'settings.eq.mode.current': 'Mode',
  'settings.eq.mode.pro': 'Pro',
  'settings.eq.mode.simple': 'Simple',
  'settings.eq.section.channel': 'Channel and monitor tools',
  'settings.eq.section.compare': 'A/B and bypass compare',
  'settings.eq.subtitle': 'Sound curve, safe headroom, and advanced tuning',
  'settings.eq.title': 'EQ',
  'settings.eq.warning.channelClipping': 'Clipping risk: lower gain or preamp for safer headroom.',
  'settings.eq.warning.lowerPreamp': 'Lower Preamp to avoid clipping.',
  'settings.nav.appearance.label': 'Appearance',
  'settings.nav.appearance.description': 'Theme, font, background',
  'settings.nav.library.label': 'Media Library',
  'settings.nav.library.description': 'Import, scan, and cleanup',
  'settings.nav.plugins.label': 'Plugins',
  'settings.nav.plugins.description': 'Local extensions, permissions, and scripts',
  'settings.plugins.card.title': 'Local Plugins',
  'settings.plugins.card.description': 'Plugins live under userData/plugins by default, and users can edit echo.plugin.json, plugin.js, and panel files directly.',
  'settings.plugins.meta.runtime': 'Runtime',
  'settings.plugins.meta.runtimeValue': 'Local sandbox',
  'settings.plugins.meta.defaultState': 'Default state',
  'settings.plugins.meta.defaultStateValue': 'Manually enabled',
  'settings.plugins.meta.permissions': 'Permissions',
  'settings.plugins.meta.permissionsValue': 'Confirm on enable',
  'settings.plugins.meta.playbackSafety': 'Playback safety',
  'settings.plugins.meta.playbackSafetyValue': 'Does not enter the audio hot path',
  'settings.plugins.action.openPage': 'Open Plugins Page',
  'settings.plugins.action.openDirectory': 'Open Plugin Directory',
  'settings.plugins.action.createExample': 'Create Example Plugin',
  'settings.plugins.action.openDocs': 'View Plugin Docs',
  'settings.plugins.note': 'The plugins page handles enable, disable, reload, commands, and logs. This card keeps the entry points and safety-boundary notes here so the management UI does not split in two.',
  'settings.nav.about.label': 'About / Advanced',
  'settings.nav.about.description': 'Version, updates, and developer tools',
  'settings.nav.danger.label': 'Danger Zone',
  'settings.nav.danger.description': 'Recovery and network safety',
  'settings.general.artistInfoSources.description': 'Choose the encyclopedia sources used when refreshing artist bios. Baidu Baike fits Chinese network contexts better, while Wikipedia can backstop international artists.',
  'settings.general.artistInfoSources.title': 'Artist Info Sources',
  'settings.general.artistStreamingAlbums.description': 'When enabled, artist detail pages can search for and show streaming albums below local albums on demand. On by default; turn it off to avoid extra page and network pressure.',
  'settings.general.artistStreamingAlbums.title': 'Streaming Albums',
  'settings.general.language.title': 'Display Language',
  'settings.general.language.description': 'Choose the language used by menus, in-app settings, and system dialogs.',
  'settings.general.dataBackup.title': 'Automatic Data Backup',
  'settings.general.dataBackup.description': 'Back up settings, library indexes, playback memory, local account state, wallpapers, cover cache, and metadata. The library database is validated before backup, and corrupted data is rejected.',
  'settings.general.dataBackup.status.enabled': 'Automatic backup is on',
  'settings.general.dataBackup.status.disabled': 'Automatic backup is off',
  'settings.general.dataBackup.hint.directoryReady': 'Directory is set. You can back up now or turn on scheduled backups.',
  'settings.general.dataBackup.hint.chooseDirectory': 'Choose a backup directory first',
  'settings.general.dataBackup.frequency.aria': 'Automatic backup interval',
  'settings.general.dataBackup.frequency.days': '{days} days',
  'settings.general.dataBackup.frequency.monthly': 'Monthly',
  'settings.general.dataBackup.meta.directory': 'Directory',
  'settings.general.dataBackup.meta.lastBackup': 'Last backup',
  'settings.general.dataBackup.meta.nextRun': 'Next run',
  'settings.general.dataBackup.meta.notSet': 'Not set',
  'settings.general.dataBackup.meta.noneYet': 'No automatic backups yet',
  'settings.general.dataBackup.meta.nextRunPending': 'Takes effect after you choose a directory and turn it on',
  'settings.general.dataBackup.meta.atPath': '{time} · {path}',
  'settings.general.dataBackup.action.chooseDirectory': 'Choose Directory',
  'settings.general.dataBackup.action.choosingDirectory': 'Choosing...',
  'settings.general.dataBackup.action.backupNow': 'Back Up Now',
  'settings.general.dataBackup.action.backingUp': 'Backing Up...',
  'settings.general.dataBackup.action.importBackup': 'Import Backup',
  'settings.general.dataBackup.action.importingBackup': 'Importing...',
  'settings.general.dataBackup.action.openDirectory': 'Open Directory',
  'settings.general.dataBackup.progress.preparing': 'Preparing',
  'settings.general.dataBackup.progress.snapshot': 'Creating snapshot',
  'settings.general.dataBackup.progress.scanning': 'Scanning data',
  'settings.general.dataBackup.progress.writing': 'Writing backup',
  'settings.general.dataBackup.progress.finalizing': 'Finalizing',
  'settings.general.dataBackup.progress.completed': 'Completed',
  'settings.general.dataBackup.progress.failed': 'Failed',
  'settings.general.dataBackup.progress.measuring': 'Measuring',
  'settings.general.dataBackup.progress.waiting': 'Waiting to write',
  'settings.general.dataPackage.title': 'Export / Migrate ECHO Data Package',
  'settings.general.dataPackage.description': 'Export settings, library indexes, playlist snapshots, cover cache paths, and account-state notes. Music files and login secrets are not included.',
  'settings.general.dataPackage.action.export': 'Export ECHO Data Package',
  'settings.general.dataPackage.action.exporting': 'Packaging...',
  'settings.general.dataPackage.action.recovery': 'Recovery Entry',
  'settings.general.dataPackage.note': 'Create a healthy snapshot in Danger Zone before restoring. The RESTORE.md file inside the package explains what each file is for.',
  'settings.general.closeToTray': 'Hide to tray on close',
  'settings.general.sidebarAutoHide.title': 'Hide Sidebar',
  'settings.general.sidebarAutoHide.description': 'Tuck the left sidebar into the screen edge, then slide it out when the pointer reaches the left edge. Off by default.',
  'settings.general.fastStartup.description': 'When enabled, startup only runs a lightweight read-only library check; the full data protection snapshot finishes in the background after the window opens. Off by default.',
  'settings.general.fastStartup.title': 'Fast Startup',
  'settings.general.firstRunWizard.description': 'Show the first-run guide again after opening. You can choose Standard Output (system audio), WASAPI, Exclusive, or ASIO; this switch turns off automatically after finishing or skipping.',
  'settings.general.firstRunWizard.title': 'First-Run Guide',
  'settings.general.playerWaveformProgress.description': 'Show a lightweight waveform-style progress bar in the bottom player. Off by default, with no audio decoding or background analysis.',
  'settings.general.playerWaveformProgress.title': 'Waveform Progress Bar',
  'settings.general.homeWaveformVisualizer.description': 'Controls the live waveform in Home > Today Echo. Turning it off hides the waveform and skips the spectrum analysis used for it.',
  'settings.general.homeWaveformVisualizer.title': 'Home Waveform Visualizer',
  'settings.general.homeRandomHeroTitle.description': 'When enabled, Home picks from a random title pool with a few internet jokes mixed in. Turning it off uses a fixed title.',
  'settings.general.homeRandomHeroTitle.title': 'Random Home Title',
  'settings.general.rememberWindowSize.description': 'Remember the window size after you resize it, then restore it automatically on the next launch.',
  'settings.general.rememberWindowSize.title': 'Remember Window Size',
  'settings.general.searchTraditionalVariants.description': 'When enabled, Traditional Chinese input can find Simplified Chinese results, and Simplified Chinese input can find Traditional Chinese results.',
  'settings.general.searchTraditionalVariants.title': 'Simplified/Traditional Search',
  'settings.general.backup.title': 'Settings Backup',
  'settings.general.backup.description': 'Export or import ECHO Next settings for migration or recovery.',
  'settings.general.backup.export': 'Export Settings',
  'settings.general.backup.import': 'Import Settings',
  'settings.playback.outputMode.asio': 'ASIO',
  'settings.playback.outputMode.title': 'Output Mode',
  'settings.playback.advancedPanel.action.collapse': 'Collapse Advanced Playback Settings',
  'settings.playback.advancedPanel.action.expand': 'Expand Advanced Playback Settings',
  'settings.playback.advancedPanel.description': 'Low-load mode, diagnostics, JUCE / DSD, export, and detailed playback controls stay folded by default so everyday output settings stay quiet.',
  'settings.playback.advancedPanel.memory': 'Expansion is remembered',
  'settings.playback.advancedPanel.title': 'Advanced Playback Settings',
  'settings.playback.asioNativeDsd.description': 'Off by default. Only tries ASIO + local DSF + DoP when EQ, volume, speed, and DSP are inactive; failures fall back to the existing DoP/PCM path.',
  'settings.playback.asioNativeDsd.title': 'ASIO Native DSD Experiment',
  'settings.playback.dsdDop.description': 'Off by default. Attempts DoP passthrough for local DSF on ASIO; failures automatically fall back to FFmpeg PCM. Trust the DAC display as the final source of truth.',
  'settings.playback.dsdDop.requiresAsio': 'Requires ASIO',
  'settings.playback.dsdDop.title': 'DSD DoP Passthrough Trial',
  'settings.playback.exportFormat.description': 'The player-bar export button uses this format; export speed follows the current playback speed.',
  'settings.playback.exportFormat.title': 'Audio Export Format',
  'settings.playback.fixedVolume.description': 'When enabled, ECHO volume control is locked at 100%; ReplayGain still applies independently.',
  'settings.playback.fixedVolume.status.fixed': 'Fixed',
  'settings.playback.fixedVolume.title': 'Fixed Volume',
  'settings.playback.gapless.description': '0-second gaps for adjacent local tracks from the same album. System output temporarily uses the native shared path; this stays separate while Automix is paused.',
  'settings.playback.gapless.title': 'Album Gapless Playback',
  'settings.playback.transportFade.curve.equalPower': 'Equal Power',
  'settings.playback.transportFade.curve.linear': 'Linear',
  'settings.playback.transportFade.curve.smooth': 'Smooth',
  'settings.playback.transportFade.description': 'Drag to 0 ms to turn off. When enabled, manual play / pause uses one shared fade duration.',
  'settings.playback.transportFade.field.curve': 'Curve',
  'settings.playback.transportFade.field.duration': 'Duration',
  'settings.playback.transportFade.field.fadeIn': 'Fade In ms',
  'settings.playback.transportFade.field.fadeOut': 'Fade Out ms',
  'settings.playback.transportFade.status.disabled': 'Disabled',
  'settings.playback.transportFade.status.enabled': 'Enabled',
  'settings.playback.transportFade.title': 'Play / Pause Fade',
  'settings.playback.issueDiagnostics.description': 'Off by default. Enable when users report playback issues; a floating window records state, progress, duration, native buffer, underrun, backend, warnings, and ended markers.',
  'settings.playback.issueDiagnostics.title': 'Audio Issue Diagnostics Window',
  'settings.playback.juceOutput.description': 'Off by default. FFmpeg compatibility remains the default output path; enable JUCE output manually when needed, with automatic fallback on failure.',
  'settings.playback.juceOutput.title': 'JUCE Main Output',
  'settings.playback.miniPlayer.action.hide': 'Hide',
  'settings.playback.miniPlayer.action.show': 'Show',
  'settings.playback.miniPlayer.autoHideNote': 'Hide the main window to the bottom-right tray when opening the mini player',
  'settings.playback.miniPlayer.description': 'Independent transparent always-on-top mini window showing only cover art, title, and progress. The window hugs the player body to avoid blocking other apps with transparent empty space.',
  'settings.playback.miniPlayer.status.hidden': 'Hidden',
  'settings.playback.miniPlayer.status.visible': 'Visible',
  'settings.playback.miniPlayer.title': 'Mini Player',
  'settings.playback.monoAudio.description': 'Merge left and right channels and output the sum to both sides. Off by default; useful for one-ear listening, damaged headphones, or quick mix checks.',
  'settings.playback.monoAudio.title': 'Mono Audio',
  'settings.playback.nativeDecode.description': 'Off by default. Uses long-lived native decoding for local WAV/FLAC/MP3 when resampling is not needed; MP3 uses Windows Media and falls back to FFmpeg on failure.',
  'settings.playback.nativeDecode.title': 'Long-Lived Native Decode',
  'settings.playback.hqplayer.defaultBackend.ask': 'Ask Each Time',
  'settings.playback.hqplayer.defaultBackend.echoNative': 'Keep ECHO Output',
  'settings.playback.hqplayer.defaultBackend.hqplayer': 'Prefer HQPlayer',
  'settings.playback.hqplayer.description': 'Prepares the HQPlayer control endpoint and playback handoff preference. It does not take over current output by default.',
  'settings.playback.hqplayer.enable': 'Enable HQPlayer Integration',
  'settings.playback.hqplayer.field.defaultBackend': 'Default Handoff',
  'settings.playback.hqplayer.field.endpoint': 'Control Endpoint',
  'settings.playback.hqplayer.field.lastChecked': 'Last Checked',
  'settings.playback.hqplayer.field.status': 'Status',
  'settings.playback.hqplayer.host': 'Host',
  'settings.playback.hqplayer.mediaServer': 'ECHO Media Service',
  'settings.playback.hqplayer.mode.localDesktop': 'Local HQPlayer Desktop',
  'settings.playback.hqplayer.mode.remote': 'Remote HQPlayer',
  'settings.playback.hqplayer.note': 'This phase only saves settings and tests TCP connectivity. It does not launch HQPlayer or change ECHO playback routing.',
  'settings.playback.hqplayer.port': 'Control Port',
  'settings.playback.hqplayer.profileName': 'Profile Name',
  'settings.playback.hqplayer.result.failed': 'Connection unavailable',
  'settings.playback.hqplayer.result.ok': 'Connection available',
  'settings.playback.hqplayer.save': 'Save',
  'settings.playback.hqplayer.saving': 'Saving',
  'settings.playback.hqplayer.status.available': 'Available',
  'settings.playback.hqplayer.status.checking': 'Checking',
  'settings.playback.hqplayer.status.disabled': 'Disabled',
  'settings.playback.hqplayer.status.notConfigured': 'Port not configured',
  'settings.playback.hqplayer.status.unavailable': 'Unavailable',
  'settings.playback.hqplayer.test': 'Test Connection',
  'settings.playback.hqplayer.testing': 'Testing',
  'settings.playback.hqplayer.title': 'HQPlayer Integration',
  'settings.playback.speedMode.description': 'Choose the mode used by the speed slider in the player bar.',
  'settings.playback.speedMode.title': 'Speed Mode',
  'settings.playback.outputMode.description': 'Use Standard Output for headphones, Bluetooth, and computer speakers. WASAPI / ASIO / Exclusive are for external audio interfaces and HiFi debugging.',
  'settings.playback.outputMode.exclusive': 'Exclusive',
  'settings.playback.outputMode.shared': 'Shared',
  'settings.playback.outputMode.system': 'Standard Output (Recommended)',
  'settings.playback.sharedBackend.description': 'DirectSound is a manual compatibility mode with high latency; keep WASAPI Shared for daily playback.',
  'settings.playback.sharedBackend.alsa': 'ALSA',
  'settings.playback.sharedBackend.auto': 'Auto',
  'settings.playback.sharedBackend.directSound': 'DirectSound Compatibility',
  'settings.playback.sharedBackend.linuxDescription': 'Linux defaults to ALSA first. If your system routes PipeWire through ALSA compatibility, it uses this shared output path too.',
  'settings.playback.sharedBackend.title': 'Shared Backend',
  'settings.playback.sharedBackend.wasapi': 'WASAPI Shared',
  'settings.playback.outputDevice.title': 'Output Device',
  'settings.playback.outputDevice.description': 'Device list from echo-audio-host. When no device is available, default output is kept.',
  'settings.playback.outputDevice.empty': 'No available devices',
  'settings.playback.resetEngine.action': 'Restart Audio Engine',
  'settings.playback.resetEngine.busy': 'Restarting',
  'settings.playback.resetEngine.description': 'Stops current playback and releases the native audio host. Try this when a device or driver gets stuck before restarting the app.',
  'settings.playback.resetEngine.done': 'Audio engine restarted. You can start playback again.',
  'settings.playback.resetEngine.title': 'Restart Audio Engine',
  'settings.playback.segmentLoop.description': 'Set A/B points for the current track, enable segment looping, and save segment bookmarks for this track.',
  'settings.playback.segmentLoop.title': 'A-B Loop',
  'settings.playback.replayGain.action.advanced': 'Advanced',
  'settings.playback.replayGain.action.analyzeMissing': 'Analyze Missing Loudness',
  'settings.playback.replayGain.action.analyzing': 'Analyzing...',
  'settings.playback.replayGain.description': 'Matches perceived loudness across songs. ECHO only reads tags or writes to its database; your music files are not modified.',
  'settings.playback.replayGain.error': '{count} loudness analysis errors; problem files were skipped.',
  'settings.playback.replayGain.field.applied': 'Current Applied',
  'settings.playback.replayGain.field.mode': 'Mode',
  'settings.playback.replayGain.field.preventClipping': 'Prevent Clipping',
  'settings.playback.replayGain.field.preamp': 'Preamp',
  'settings.playback.replayGain.field.progress': 'Progress',
  'settings.playback.replayGain.field.target': 'Target Loudness',
  'settings.playback.replayGain.mode.album': 'Album',
  'settings.playback.replayGain.mode.off': 'Off',
  'settings.playback.replayGain.mode.track': 'Track',
  'settings.playback.replayGain.notRun': 'Not Run',
  'settings.playback.replayGain.preset.quiet': 'Quiet (-18 LUFS)',
  'settings.playback.replayGain.preset.standard': 'Standard (-14 LUFS)',
  'settings.playback.replayGain.status.disabled': 'Disabled',
  'settings.playback.replayGain.status.enabled': 'Enabled',
  'settings.playback.replayGain.title': 'Volume Normalization',
  'settings.playback.replayGain.toggle.analyzeOnPlay': 'Analyze on Play',
  'settings.playback.replayGain.toggle.analyzeOnScan': 'Analyze After Scan',
  'settings.playback.replayGain.toggle.preventClipping': 'Prevent Clipping',
  'settings.playback.status.off': 'Off',
  'settings.playback.status.on': 'On',
  'settings.playback.troubleshooting.description': 'Use this when audio is stuck or the device list looks wrong. The soft restart only affects ECHO.',
  'settings.playback.troubleshooting.hardAction': 'Restart Windows Audio Service',
  'settings.playback.troubleshooting.hardBusy': 'Restarting Windows Audio Service',
  'settings.playback.troubleshooting.hardConfirm': 'This will interrupt audio from all apps (Chrome, games, calls) and requires administrator permission. Continue?',
  'settings.playback.troubleshooting.hardDone': 'Windows audio service recovered. You can start playback again.',
  'settings.playback.troubleshooting.softAction': 'Restart Audio Engine',
  'settings.playback.troubleshooting.softBusy': 'Restarting Audio Engine',
  'settings.playback.troubleshooting.softDone': 'Audio engine restarted. You can start playback again.',
  'settings.playback.troubleshooting.title': 'Audio Troubleshooting',
  'settings.playback.wireless.title': 'Wireless Playback',
  'settings.playback.wireless.description': 'This will connect in a later HiFi engine phase. The current phase does not migrate gapless / automix / streaming.',
  'settings.shortcuts.action.clear': 'Clear',
  'settings.shortcuts.action.bossKey.description': 'Hide the window immediately and lower ECHO volume to 0.',
  'settings.shortcuts.action.bossKey.title': 'Boss Key',
  'settings.shortcuts.action.nextTrack.description': 'Jump to the next item in the active playback queue.',
  'settings.shortcuts.action.nextTrack.title': 'Next Track',
  'settings.shortcuts.action.openAudioSettings.description': 'Open the player audio settings drawer.',
  'settings.shortcuts.action.openAudioSettings.title': 'Open Audio Settings',
  'settings.shortcuts.action.openLyricsSettings.description': 'Open the lyrics settings drawer.',
  'settings.shortcuts.action.openLyricsSettings.title': 'Open Lyrics Settings',
  'settings.shortcuts.action.openMvSettings.description': 'Open the MV settings drawer.',
  'settings.shortcuts.action.openMvSettings.title': 'Open MV Settings',
  'settings.shortcuts.action.locateCurrentTrack.description': 'Scroll the current list back to the playing track.',
  'settings.shortcuts.action.locateCurrentTrack.title': 'Locate Playing Track',
  'settings.shortcuts.action.playPause.description': 'Toggle play and pause globally.',
  'settings.shortcuts.action.playPause.title': 'Play / Pause',
  'settings.shortcuts.action.previousTrack.description': 'Jump to the previous item in the active playback queue.',
  'settings.shortcuts.action.previousTrack.title': 'Previous Track',
  'settings.shortcuts.action.record': 'Record',
  'settings.shortcuts.action.restoreRecommended': 'Restore Recommended',
  'settings.shortcuts.action.seekBackward.description': 'Seek the current track backward by 10 seconds.',
  'settings.shortcuts.action.seekBackward.title': 'Seek Back 10s',
  'settings.shortcuts.action.seekForward.description': 'Seek the current track forward by 10 seconds.',
  'settings.shortcuts.action.seekForward.title': 'Seek Forward 10s',
  'settings.shortcuts.action.showMainWindow.description': 'Bring the ECHO main window to the front.',
  'settings.shortcuts.action.showMainWindow.title': 'Show Main Window',
  'settings.shortcuts.action.speedDown.description': 'Lower playback speed by 0.1x each time.',
  'settings.shortcuts.action.speedDown.title': 'Speed Down',
  'settings.shortcuts.action.speedUp.description': 'Raise playback speed by 0.1x each time.',
  'settings.shortcuts.action.speedUp.title': 'Speed Up',
  'settings.shortcuts.action.stop.description': 'Stop current playback and clear the active playback state.',
  'settings.shortcuts.action.stop.title': 'Stop Playback',
  'settings.shortcuts.action.toggleDesktopLyrics.description': 'Show or hide the desktop lyrics window.',
  'settings.shortcuts.action.toggleDesktopLyrics.title': 'Show / Hide Desktop Lyrics',
  'settings.shortcuts.action.volumeDown.description': 'Lower ECHO volume by 5%.',
  'settings.shortcuts.action.volumeDown.title': 'Volume Down',
  'settings.shortcuts.action.volumeUp.description': 'Raise ECHO volume by 5%.',
  'settings.shortcuts.action.volumeUp.title': 'Volume Up',
  'settings.shortcuts.column.function': 'Function',
  'settings.shortcuts.column.local': 'Shortcut',
  'settings.shortcuts.column.global': 'Global Shortcut',
  'settings.shortcuts.description': 'Shortcuts work only while the ECHO window is focused. Global shortcuts also work in the background and are checked for system conflicts.',
  'settings.shortcuts.empty': 'Not bound',
  'settings.shortcuts.localUnavailable': 'Global only',
  'settings.shortcuts.message.duplicate': 'That shortcut is already bound to another action.',
  'settings.shortcuts.message.empty': 'Record a shortcut first.',
  'settings.shortcuts.message.invalid': 'That key cannot be used as a shortcut right now.',
  'settings.shortcuts.message.safe': 'This shortcut is available.',
  'settings.shortcuts.message.unavailable': 'That shortcut is used by the system or another app, so it stayed disabled.',
  'settings.shortcuts.message.unsafe': 'That key cannot be used as a shortcut right now. You can make the macro pad emit a standard keyboard or media key.',
  'settings.shortcuts.note': 'Single keys, combinations, media keys, macro-pad keys, and mouse side buttons are supported. Local shortcuts do not trigger inside text fields.',
  'settings.shortcuts.recording': 'Press a new shortcut...',
  'settings.shortcuts.scope.local': 'Shortcut',
  'settings.shortcuts.scope.global': 'Global Shortcut',
  'settings.shortcuts.title': 'Shortcuts',
  'settings.playback.audioStatus.title': 'Audio Status',
  'settings.playback.audioStatus.description': 'Sample-rate fields stay separated to prevent the old ECHO exclusive-mode 48k lock regression.',
  'settings.playback.automix.description': 'Off by default. When enabled, continuous queues prepare the next track early and use the native dual-deck engine to skip tail silence and blend transitions.',
  'settings.playback.automix.title': 'Automix Smart Transitions',
  'settings.playback.stability.action.copied': 'Copied',
  'settings.playback.stability.action.copy': 'Copy Diagnostics',
  'settings.playback.stability.action.refresh': 'Refresh Playback Stability Diagnostics',
  'settings.playback.stability.error.desktopBridgeUnavailable': 'Desktop bridge unavailable.',
  'settings.playback.stability.field.lastSharedStabilityRecoveryAt': 'Last Shared stability recovery',
  'settings.playback.stability.field.lastWatchdogRecoveryTime': 'Last watchdog recovery time',
  'settings.playback.stability.field.nativeBufferedFrames': 'Native buffered frames',
  'settings.playback.stability.field.nativeBufferedMs': 'Native buffered ms',
  'settings.playback.stability.field.nativeDeviceBufferFrames': 'Device buffer frames',
  'settings.playback.stability.field.nativeFifoCapacityFrames': 'Native FIFO capacity frames',
  'settings.playback.stability.field.nativeStartupPrebufferFrames': 'Startup prebuffer frames',
  'settings.playback.stability.field.nativeUnderrunCallbacks': 'Native underrun callbacks',
  'settings.playback.stability.field.nativeUnderrunFrames': 'Native underrun frames',
  'settings.playback.stability.field.recentWatchdogRecoveryCount': 'Recent watchdog recovery count',
  'settings.playback.stability.field.sharedStabilityTier': 'Shared stability tier',
  'settings.playback.stability.field.watchdogStatus': 'Watchdog status',
  'settings.playback.stability.title': 'Playback Stability Diagnostics',
  'settings.playback.stability.value.unknown': 'N/A',
  'settings.integrations.discord.action.refresh': 'Refresh status',
  'settings.integrations.discord.title': 'Discord Status',
  'settings.integrations.discord.description': 'Sync the current playback state to Discord Rich Presence, including track, artist, progress, and play state.',
  'settings.integrations.smtc.description': 'Publish the current track, artwork, timeline, and media-key actions to the Windows volume flyout and lock screen.',
  'settings.integrations.smtc.action.restart': 'Restart SMTC',
  'settings.integrations.smtc.action.restarting': 'Restarting...',
  'settings.integrations.taskbarPlayback.description': 'Show playback progress on the Windows taskbar icon and add previous, play/pause, and next buttons to the hover preview.',
  'settings.integrations.taskbarPlayback.title': 'Taskbar Music Controls',
  'settings.integrations.smtc.title': 'Windows Media Controls',
  'settings.integrations.lastfm.action.completeAuth': 'Complete authorization',
  'settings.integrations.lastfm.action.connect': 'Connect Last.fm',
  'settings.integrations.lastfm.action.disconnect': 'Disconnect',
  'settings.integrations.lastfm.action.refresh': 'Refresh status',
  'settings.integrations.lastfm.activeProgress': '{artist} - {title} · {played}/{threshold}s',
  'settings.integrations.lastfm.activeTrack': 'Active track',
  'settings.integrations.lastfm.connection.description': 'Browser authorization is recommended. Click complete after allowing ECHO Next on Last.fm.',
  'settings.integrations.lastfm.connection.title': 'Last.fm connection',
  'settings.integrations.lastfm.description': 'Scrobble local playback from the main process without sending file paths, lyrics, or artwork.',
  'settings.integrations.lastfm.lastNowPlaying': 'Last Now Playing',
  'settings.integrations.lastfm.lastScrobble': 'Last Scrobble',
  'settings.integrations.lastfm.never': 'Not sent yet',
  'settings.integrations.lastfm.noActiveTrack': 'No active track',
  'settings.integrations.lastfm.nowPlaying.description': 'Send one current-track update when playback starts.',
  'settings.integrations.lastfm.nowPlaying.title': 'Last.fm Now Playing',
  'settings.integrations.lastfm.scrobbling.description': 'Submit a play after the track passes the Last.fm timing threshold.',
  'settings.integrations.lastfm.scrobbling.title': 'Last.fm Scrobbling',
  'settings.integrations.lastfm.status.connected': 'Connected {username}',
  'settings.integrations.lastfm.status.error': 'Error: {error}',
  'settings.integrations.lastfm.status.notConnected': 'Not connected',
  'settings.integrations.lastfm.status.pending': 'Authorization pending',
  'settings.integrations.lastfm.statusLabel': 'Status',
  'settings.integrations.lastfm.title': 'Last.fm',
  'settings.integrations.mobile.title': 'Mobile Remote',
  'settings.integrations.mobile.description': 'Future external-device features will go through controlled IPC instead of direct Renderer system access.',
  'settings.integrations.accounts.cookieFallback': 'Cookies are saved automatically after account login; manual Cookie paste is the fallback.',
  'settings.integrations.accounts.cookiePlaceholder': 'Paste Cookie and save',
  'settings.integrations.accounts.description.default': 'Reserved for lyrics, metadata, and download integrations.',
  'settings.integrations.accounts.description.bilibili': 'Used for MV parsing and high-quality playback.',
  'settings.integrations.accounts.loginAndSync': 'Log In And Sync',
  'settings.integrations.accounts.clickToLogin': 'Not Logged In, Click To Log In',
  'settings.integrations.accounts.logout': 'Log Out',
  'settings.integrations.accounts.logoutBusy': 'Logging out...',
  'settings.integrations.accounts.manualSave': 'Save Manually',
  'settings.integrations.accounts.manualSaveBusy': 'Saving...',
  'settings.integrations.accounts.check': 'Check',
  'settings.integrations.accounts.checkBusy': 'Checking...',
  'settings.integrations.accounts.loginBusy': 'Waiting for login...',
  'settings.integrations.accounts.loginMeta': 'Login {loginAt} · Check {checkedAt}',
  'settings.integrations.accounts.loginStatus': 'Login status',
  'settings.integrations.accounts.soundcloudNote': 'SoundCloud streaming uses the login Cookie saved here and does not require Artist Pro or a developer API.',
  'settings.integrations.accounts.osuNote': 'osu! beatmap downloads prefer the login Cookie saved here; if the official source fails, Sayobot, Catboy, and NeriNyan mirrors are tried automatically.',
  'settings.integrations.accounts.youtube.browser': 'Browser',
  'settings.integrations.accounts.youtube.browserNone': 'Do not use',
  'settings.integrations.accounts.youtube.description': 'Reuses the system-browser login flow for later parsing and downloads.',
  'settings.integrations.accounts.youtube.savedStatus': 'Choosing a browser saves that system-browser login state.',
  'settings.integrations.accounts.spotify.description': 'Official player integration. Premium is required; enter your own Spotify Client ID above and register the redirect URI in Spotify Dashboard.',
  'settings.integrations.accounts.spotify.login': 'Log In To Spotify',
  'settings.integrations.accounts.spotify.loginBusy': 'Waiting for authorization...',
  'settings.integrations.accounts.spotify.savedStatus': 'Uses OAuth PKCE without storing a Client Secret; download features do not apply to Spotify.',
  'settings.integrations.accountPanel.title': 'Account Login',
  'settings.integrations.accountPanel.description': 'Stores platform login state for later lyrics, metadata, MV, downloads, and streaming integrations. Cookies are saved automatically after account login.',
  'settings.integrations.accountPanel.refreshAll': 'Refresh All',
  'settings.integrations.accountStartupRefresh.title': 'Refresh account login state on startup',
  'settings.integrations.accountStartupRefresh.description': 'Only checks accounts that have logged in before; platforms never used before stay quiet.',
  'settings.integrations.accountExpiryNotices.title': 'Disable account expiry notices',
  'settings.integrations.accountExpiryNotices.description': 'When enabled, expired accounts no longer trigger the top-left reminder; you can still check account status here.',
  'settings.integrations.credentialPanel.title': 'Developer / API Setup',
  'settings.integrations.credentialPanel.description': 'Spotify, TIDAL, Discogs, online artist sources, and Last.fm. Leave it collapsed if you do not need it.',
  'settings.integrations.credentialPanel.expand': 'Expand API Setup',
  'settings.integrations.credentialPanel.collapse': 'Collapse API Setup',
  'settings.integrations.smtcLyrics.title': 'SMTC Lyrics Display',
  'settings.integrations.smtcLyrics.description': 'Allows the current lyric line to be appended to Windows media info. Off by default to avoid polluting the artist field.',
  'settings.integrations.spotifyAutoLaunchOfficialPlayer.title': 'Auto-launch the official Spotify player',
  'settings.integrations.spotifyAutoLaunchOfficialPlayer.description': 'When playing Spotify, if the built-in ECHO SDK cannot be used because DRM is unavailable, ECHO automatically opens the Spotify desktop app or web player and hands off the Connect device.',
  'settings.integrations.networkProxy.title': 'Network Proxy',
  'settings.integrations.networkProxy.description': 'Used for login pages, online covers, lyrics, MV search, and metadata enrichment. Media playback streams bypass the proxy by default to avoid affecting buffering and Range requests.',
  'settings.integrations.networkProxy.mode': 'Mode',
  'settings.integrations.networkProxy.modeAria': 'Network proxy mode',
  'settings.integrations.networkProxy.mode.off': 'Off',
  'settings.integrations.networkProxy.mode.system': 'System Proxy',
  'settings.integrations.networkProxy.mode.manual': 'Manual Proxy',
  'settings.integrations.networkProxy.manualUrl': 'Manual proxy URL',
  'settings.integrations.networkProxy.manualPlaceholder': 'http://127.0.0.1:7890 or socks5://127.0.0.1:7890',
  'settings.integrations.networkProxy.pacUrl': 'PAC URL',
  'settings.integrations.networkProxy.bypass': 'Bypass rules',
  'settings.integrations.networkProxy.save': 'Save And Apply',
  'settings.integrations.networkProxy.saveBusy': 'Saving...',
  'settings.integrations.networkProxy.test': 'Test Connection',
  'settings.integrations.networkProxy.testBusy': 'Testing...',
  'settings.integrations.networkProxy.note': 'The first version proxies only ordinary network features by default. Remote libraries and playback byte streams stay direct to protect playback stability.',
  'settings.library.network.description': 'Manual weak completion only; local embedded metadata always keeps priority.',
  'settings.library.network.title': 'Network Metadata Completion',
  'settings.library.networkSources.description': 'Choose providers used by manual repair and missing-metadata scans.',
  'settings.library.networkSources.title': 'Network Completion Sources',
  'settings.library.networkPanel.applyMissingOnly': 'Apply missing only',
  'settings.library.networkPanel.applySelected': 'Apply selected candidate',
  'settings.library.networkPanel.appliedCount': 'Auto-applied count',
  'settings.library.networkPanel.artistField': 'Artist',
  'settings.library.networkPanel.artistSource': 'Artist source',
  'settings.library.networkPanel.candidates': 'Candidates',
  'settings.library.networkPanel.cover': 'Cover',
  'settings.library.networkPanel.embeddedCover': 'Embedded cover',
  'settings.library.networkPanel.embeddedMetadata': 'Embedded metadata',
  'settings.library.networkPanel.kicker': 'Manual repair',
  'settings.library.networkPanel.localCover': 'Local',
  'settings.library.networkPanel.missingCover': 'Missing/default',
  'settings.library.networkPanel.noCandidates': 'No network candidate yet.',
  'settings.library.networkPanel.providerErrors': 'Provider errors',
  'settings.library.networkPanel.reject': 'Reject',
  'settings.library.networkPanel.repairMissing': 'Repair current song',
  'settings.library.networkPanel.repairThisTrack': 'Repair this track',
  'settings.library.networkPanel.scanComplete': 'Scan complete',
  'settings.library.networkPanel.scanMissing': 'Scan missing info',
  'settings.library.networkPanel.scanDone': 'Scanned missing tracks',
  'settings.library.networkPanel.scanPreparing': 'Preparing scan',
  'settings.library.networkPanel.scanProgress': 'Missing metadata scan progress',
  'settings.library.networkPanel.scanRunning': 'Scanning network providers',
  'settings.library.networkPanel.showCandidates': 'Show Candidates',
  'settings.library.networkPanel.title': 'Missing Metadata Repair',
  'settings.library.networkPanel.titleField': 'Title',
  'settings.library.networkPanel.trackId': 'Track id',
  'settings.library.networkPanel.trackNotFound': 'Track not found. Play a track first, or enter a track ID.',
  'settings.library.networkPanel.unknownArtist': 'Unknown Artist',
  'settings.library.networkPanel.untitled': 'Untitled',
  'settings.remote.hero.title': 'Cloud / Remote Music Library',
  'settings.remote.hero.summary': 'Cloud / WebDAV / AList / NAS / Subsonic / Jellyfin / Emby',
  'settings.remote.hero.description': 'Connect WebDAV drives such as AList, Nutstore, and Nextcloud, or browse Jellyfin, Emby, Navidrome, NAS, or SSHFS as standalone music sources. ECHO builds a local index for remote tracks so lyrics, MVs, playback progress, favorites, and history keep working.',
  'settings.remote.guardrail.aria': 'Remote library sync boundary',
  'settings.remote.guardrail.title': 'Local playback first',
  'settings.remote.guardrail.description': 'Remote sync plus artwork and metadata completion always run in the background with rate limits. Concurrency is lowered while playback is active. The current offline boundary only covers indexes, artwork, and small metadata caches, and never silently mirrors the full music files.',
  'settings.remote.coverPerformance.aria': 'Remote artwork loading performance',
  'settings.remote.coverPerformance.title': 'Loading Performance',
  'settings.remote.coverPerformance.description': 'Controls how aggressively remote artwork is prefetched. This only affects list artwork loading and never changes audio streaming.',
  'settings.remote.coverPerformance.groupAria': 'Remote artwork loading preset',
  'settings.remote.coverPerformance.option.low': 'Data Saver',
  'settings.remote.coverPerformance.option.low.description': 'Only prefetch the artwork that is currently visible. Best for public networks or weaker servers.',
  'settings.remote.coverPerformance.option.balanced': 'Balanced',
  'settings.remote.coverPerformance.option.balanced.description': 'Prefetch the current area plus roughly half to one extra screen ahead. Recommended by default.',
  'settings.remote.coverPerformance.option.aggressive': 'Aggressive Prefetch',
  'settings.remote.coverPerformance.option.aggressive.description': 'Fetch more artwork ahead when scrolling pauses. Best for Navidrome on a local network.',
  'settings.remote.coverPerformance.option.lan': 'LAN Speed',
  'settings.remote.coverPerformance.option.lan.description': 'Max out remote artwork prefetch and background loading concurrency. Best for local machines, NAS, or a stable gigabit LAN.',
  'settings.remote.albumMerge.aria': 'Remote album merge strategy',
  'settings.remote.albumMerge.title': 'Album Merge',
  'settings.remote.albumMerge.description': 'Only affects how cloud / remote albums are grouped in the list. It does not touch the local library, file tags, or playback.',
  'settings.remote.albumMerge.groupAria': 'Remote album merge preset',
  'settings.remote.albumMerge.option.conservative': 'Conservative Merge',
  'settings.remote.albumMerge.option.conservative.description': 'Prefer the server album ID first. For standard cloud drives, only merge tracks from the same source, folder, and album.',
  'settings.remote.albumMerge.option.standard': 'Standard Merge',
  'settings.remote.albumMerge.option.standard.description': 'Keeps the conservative boundary but tolerates more title differences, merging case changes, symbols, and remote splits like - Single.',
  'settings.remote.albumMerge.stat.current': 'Original albums',
  'settings.remote.albumMerge.stat.target': 'Merged albums',
  'settings.remote.albumMerge.stat.tracks': 'Indexed remote tracks',
  'settings.remote.albumMerge.pending': 'Pending Scan',
  'settings.remote.albumMerge.action.scan': 'Scan Remote Library',
  'settings.remote.albumMerge.action.scanning': 'Scanning...',
  'settings.remote.albumMerge.action.apply': 'Apply And Regroup',
  'settings.remote.albumMerge.action.applying': 'Regrouping...',
  'settings.remote.library.title': 'Remote Music Library',
  'settings.remote.library.description': 'Cloud / remote / streaming sources are blocked in this phase; only the settings group remains.',
  'segmentLoop.action.clear': 'Clear current A-B points',
  'segmentLoop.action.deleteBookmark': 'Delete segment bookmark {label}',
  'segmentLoop.action.deleteBookmarkTitle': 'Delete segment bookmark',
  'segmentLoop.action.loopBookmark': 'Loop segment {label}',
  'segmentLoop.action.loopBookmarkTitle': 'Loop {label}',
  'segmentLoop.action.saveBookmark': 'Save current segment bookmark',
  'segmentLoop.action.setA': 'Set current position as point A',
  'segmentLoop.action.setB': 'Set current position as point B',
  'segmentLoop.action.toggle': 'Toggle A-B loop',
  'segmentLoop.action.toggleTitle': 'Turn A-B loop on or off',
  'segmentLoop.aria.bookmarks': 'Segment bookmarks for current track',
  'segmentLoop.aria.panel': 'A-B loop and segment bookmarks',
  'segmentLoop.empty': 'Saved segments will appear here',
  'segmentLoop.notSet': 'Not set',
  'spotifyPlayback.error.noDevice': 'No Spotify playback device is available. Enable "auto-launch official player", or open Spotify desktop/web first.{hint}',
  'spotifyPlayback.error.noDrmKeysystem': 'This Electron build has no available DRM/Widevine keysystem, so the official Spotify player cannot register a device inside ECHO.',
  'settings.appearance.theme.title': 'Theme',
  'settings.appearance.theme.description': 'Choose light, dark, or follow the system appearance.',
  'settings.appearance.theme.light': 'Light',
  'settings.appearance.theme.dark': 'Dark',
  'settings.appearance.theme.followSystem': 'Follow System',
  'settings.appearance.themeSchedule.title': 'Scheduled Dark Mode',
  'settings.appearance.themeSchedule.description': 'Use the system clock to switch to dark mode at the chosen time, then switch back to light mode later.',
  'settings.appearance.themeSchedule.toggle': 'Enable Schedule',
  'settings.appearance.themeSchedule.toggleAria': 'Enable scheduled dark mode switching',
  'settings.appearance.themeSchedule.darkAt': 'Switch To Dark',
  'settings.appearance.themeSchedule.lightAt': 'Switch Back To Light',
  'settings.appearance.themeSchedule.status.enabled': 'Enabled: switch to {mode} at {darkAt}, then automatically switch back to light at {lightAt}. The current local time is using {mode}.',
  'settings.appearance.themeSchedule.status.disabled': 'When disabled, the manual theme mode above stays in effect.',
  'settings.appearance.sidebar.title': 'Sidebar',
  'settings.appearance.sidebar.description': 'Adjust the order and visibility of sidebar entries without affecting pages or playback.',
  'settings.appearance.sidebar.expand': 'Expand sidebar layout',
  'settings.appearance.sidebar.collapse': 'Collapse sidebar layout',
  'settings.appearance.sidebar.mainGroup': 'Main Navigation',
  'settings.appearance.sidebar.utilityGroup': 'Bottom Entries',
  'settings.appearance.sidebar.reset': 'Reset',
  'settings.appearance.sidebar.visible': 'Visible',
  'settings.appearance.sidebar.hidden': 'Hidden',
  'settings.appearance.sidebar.fixed': 'Always Visible',
  'settings.appearance.sidebar.noItems': 'There are no adjustable entries in this group.',
  'settings.appearance.sidebar.summary.allVisible': 'All Visible',
  'settings.appearance.sidebar.summary.hidden': '{count} entries hidden',
  'settings.appearance.sidebar.count': '{count} items',
  'settings.appearance.sidebar.moveUp': 'Move Up',
  'settings.appearance.sidebar.moveDown': 'Move Down',
  'settings.appearance.sidebar.moveUpAria': 'Move up {label}',
  'settings.appearance.sidebar.moveDownAria': 'Move down {label}',
  'settings.appearance.sidebar.hideAria': 'Hide {label}',
  'settings.appearance.sidebar.showAria': 'Show {label}',
  'settings.appearance.nowPlayingCoverColor.title': 'Now Playing Cover Color',
  'settings.appearance.nowPlayingCoverColor.description': 'Sample the small cover art while idle to tint the Now Playing page. Low-load playback mode skips it automatically. Off by default.',
  'settings.appearance.wallpaper.title': 'Custom Background',
  'settings.appearance.wallpaper.description': 'Landscape and portrait backgrounds are saved separately. Portrait windows only apply the portrait background. Supports images and local videos.',
  'settings.appearance.wallpaper.choose': 'Choose Landscape Background',
  'settings.appearance.wallpaper.clear': 'Clear Landscape Background',
  'settings.appearance.wallpaper.portraitChoose': 'Choose Portrait Background',
  'settings.appearance.wallpaper.portraitClear': 'Clear Portrait Background',
  'settings.appearance.wallpaper.landscapePath': 'Landscape',
  'settings.appearance.wallpaper.portraitPath': 'Portrait',
  'settings.appearance.wallpaper.videoStatus': 'Video Wallpaper · Muted Loop',
  'settings.appearance.wallpaper.videoPause.smart': 'Smart Pause',
  'settings.appearance.wallpaper.videoPause.minimized': 'Pause When Minimized',
  'settings.appearance.wallpaper.videoPause.never': 'Always Play',
  'settings.appearance.wallpaper.scale': 'Wallpaper Scale',
  'settings.appearance.wallpaper.blur': 'Wallpaper Blur',
  'settings.appearance.wallpaper.brightness': 'Wallpaper Brightness',
  'settings.appearance.wallpaper.uiOpacity': 'UI Opacity',
  'settings.appearance.wallpaper.visualProtection': 'Visual Protection',
  'settings.appearance.wallpaper.unifiedOpacity': 'Unified Opacity',
  'settings.appearance.themePreset.title': 'Theme Presets',
  'settings.appearance.themePreset.description': 'Choose a global gradient palette; your light, dark, or system mode stays separate.',
  'settings.appearance.themePreset.classic': 'Classic ECHO Next',
  'settings.appearance.themePreset.classic.description': 'White and light gray surfaces with a restrained blue-violet accent, closer to Roon.',
  'settings.appearance.themePreset.echoTwilight': 'Twilight Peach Mist',
  'settings.appearance.themePreset.echoTwilight.description': 'Warm pink gradients inspired by classic ECHO.',
  'settings.appearance.themePreset.sakuraMilk': 'Sakura Milk',
  'settings.appearance.themePreset.sakuraMilk.description': 'Milky pink with a cherry-red accent.',
  'settings.appearance.themePreset.peachSoda': 'Peach Soda',
  'settings.appearance.themePreset.peachSoda.description': 'Peach orange with a fresh soda-mint lift.',
  'settings.appearance.themePreset.mintCandy': 'Mint Candy',
  'settings.appearance.themePreset.mintCandy.description': 'Mint green, cream white, and a little peach pink.',
  'settings.appearance.themePreset.berryDream': 'Berry Dream',
  'settings.appearance.themePreset.berryDream.description': 'Soft berry purple, cloud white, and dreamy pink light.',
  'settings.appearance.themePreset.matchaCream': 'Matcha Cream',
  'settings.appearance.themePreset.matchaCream.description': 'Matcha green and cream yellow for a calmer cute look.',
  'settings.appearance.themePreset.lemonMochi': 'Lemon Mochi',
  'settings.appearance.themePreset.lemonMochi.description': 'Milky lemon yellow with a soft sky-blue lift.',
  'settings.appearance.themePreset.cottonCloud': 'Cotton Cloud',
  'settings.appearance.themePreset.cottonCloud.description': 'Cloud white, gentle blue, and a soft pink accent.',
  'settings.appearance.themePreset.melonCream': 'Melon Cream',
  'settings.appearance.themePreset.melonCream.description': 'Melon green over cream, cute and readable.',
  'settings.appearance.themePreset.seaSaltJelly': 'Sea Salt Jelly',
  'settings.appearance.themePreset.seaSaltJelly.description': 'Sea-salt cyan with a peachy jelly glow.',
  'settings.appearance.themePreset.caramelPudding': 'Caramel Pudding',
  'settings.appearance.themePreset.caramelPudding.description': 'Creamy caramel with a strawberry glow, sweet but readable.',
  'settings.appearance.themePreset.neonCandy': 'Neon Candy',
  'settings.appearance.themePreset.neonCandy.description': 'Violet neon, pink highlights, and mint bubbles.',
  'settings.appearance.themePreset.nyanCat': 'Nyan Cat',
  'settings.appearance.themePreset.nyanCat.description': 'A slow, cute rainbow gradient with a Nyan Cat progress handle.',
  'settings.appearance.themePreset.childrenDoodle': 'Kids Doodle',
  'settings.appearance.themePreset.childrenDoodle.description': 'Paper grain, crayon borders, and messy sticker doodles for Children\'s Day.',
  'settings.appearance.themePreset.wisteriaBubble': 'Wisteria Bubble',
  'settings.appearance.themePreset.wisteriaBubble.description': 'Wisteria mist with mint bubbles, dreamy but fresh.',
  'settings.appearance.themePreset.strawberryCookie': 'Strawberry Cookie',
  'settings.appearance.themePreset.strawberryCookie.description': 'Cream-cookie warmth with strawberry red and baked gold.',
  'settings.appearance.themePreset.graphiteAurora': 'Graphite Aurora',
  'settings.appearance.themePreset.graphiteAurora.description': 'Graphite gray with a quiet green aurora edge.',
  'settings.appearance.themePreset.amberNoir': 'Amber Noir',
  'settings.appearance.themePreset.amberNoir.description': 'Black-gold listening room tones for long dark sessions.',
  'settings.appearance.themePreset.oceanStudio': 'Ocean Studio',
  'settings.appearance.themePreset.oceanStudio.description': 'Cool blue-gray and sea mist for a clean studio feel.',
  'settings.appearance.themePreset.rosewoodVinyl': 'Rosewood Vinyl',
  'settings.appearance.themePreset.rosewoodVinyl.description': 'Warm rosewood reds with a grounded vinyl mood.',
  'settings.appearance.themePreset.darkSideMoon': 'The Dark Side of the Moon',
  'settings.appearance.themePreset.darkSideMoon.description': 'A Pink Floyd tribute: black lunar glass, white prism, and spectral color.',
  'settings.appearance.themePreset.shibuyaNight': 'Shibuya Night',
  'settings.appearance.themePreset.shibuyaNight.description': 'Tokyo neon, night violet streets, and cyan signage glow.',
  'settings.appearance.themePreset.kyotoKurenai': 'Kyoto Kurenai',
  'settings.appearance.themePreset.kyotoKurenai.description': 'Torii red, warm washi paper, and omamori gold.',
  'settings.appearance.themePreset.ukiyoIndigo': 'Ukiyo Indigo',
  'settings.appearance.themePreset.ukiyoIndigo.description': 'Ukiyo-e wave indigo with paper warmth and antique gold.',
  'settings.appearance.themePreset.fujiSnow': 'Fuji First Snow',
  'settings.appearance.themePreset.fujiSnow.description': 'Snow white, Fuji blue, and a pale sakura highlight.',
  'settings.appearance.themePreset.matsuriLantern': 'Matsuri Lantern',
  'settings.appearance.themePreset.matsuriLantern.description': 'Summer festival lantern red, market gold, and warm paper.',
  'settings.appearance.themePreset.ginzaNoir': 'Ginza Noir',
  'settings.appearance.themePreset.ginzaNoir.description': 'Obsidian, champagne gold, and boutique-window blue.',
  'settings.appearance.themePreset.frostJazz': 'Frost Jazz',
  'settings.appearance.themePreset.frostJazz.description': 'Cool blue jazz tones with a plum stage-light accent.',
  'settings.appearance.themePreset.FINAL': 'FINAL',
  'settings.appearance.themePreset.FINAL.description': 'A restrained monitor tone inspired by final product photography, acoustic engineering, and 8K SOUND.',
  'settings.appearance.themeCustom.title': 'Customize Current Theme',
  'settings.appearance.themeCustom.description': 'Choose a theme first, then tune colors. Each theme keeps its own custom colors.',
  'settings.appearance.themeCustom.action.autoFix': 'Auto-fix Text',
  'settings.appearance.themeCustom.action.create': 'New My Theme',
  'settings.appearance.themeCustom.action.rename': 'Rename',
  'settings.appearance.themeCustom.action.duplicate': 'Duplicate',
  'settings.appearance.themeCustom.action.delete': 'Delete',
  'settings.appearance.themeCustom.action.copyLightToDark': 'Copy Light to Dark',
  'settings.appearance.themeCustom.action.copyDarkToLight': 'Copy Dark to Light',
  'settings.appearance.themeCustom.action.export': 'Export Parameters',
  'settings.appearance.themeCustom.action.import': 'Import Parameters',
  'settings.appearance.themeCustom.action.reset': 'Reset Custom Colors',
  'settings.appearance.themeCustom.action.save': 'Save Custom Colors',
  'settings.appearance.themeCustom.expand': 'Expand My Theme',
  'settings.appearance.themeCustom.collapse': 'Collapse My Theme',
  'settings.appearance.themeCustom.advanced.show': 'Show Advanced Settings',
  'settings.appearance.themeCustom.advanced.hide': 'Hide Advanced Settings',
  'settings.appearance.themeCustom.field.appBg': 'Base',
  'settings.appearance.themeCustom.field.appBg2': 'Gradient Mid',
  'settings.appearance.themeCustom.field.appBg3': 'Gradient End',
  'settings.appearance.themeCustom.field.panel': 'Glass Tint',
  'settings.appearance.themeCustom.field.panelSoft': 'Soft Panel',
  'settings.appearance.themeCustom.field.accent': 'Primary Accent',
  'settings.appearance.themeCustom.field.accentStrong': 'Secondary Accent',
  'settings.appearance.themeCustom.field.secondary': 'Third Accent',
  'settings.appearance.themeCustom.field.heading': 'Main Text',
  'settings.appearance.themeCustom.field.text': 'Body Text',
  'settings.appearance.themeCustom.field.muted': 'Secondary Text',
  'settings.appearance.themeCustom.field.border': 'Border',
  'settings.appearance.themeCustom.field.onAccent': 'Accent Button Text',
  'settings.appearance.themeCustom.field.buttonText': 'Button Text',
  'settings.appearance.themeCustom.field.panelOpacity': 'Panel Opacity',
  'settings.appearance.themeCustom.field.glass': 'Glass',
  'settings.appearance.themeCustom.field.shadow': 'Shadow',
  'settings.appearance.themeCustom.field.titlebar': 'Titlebar',
  'settings.appearance.themeCustom.field.sidebar': 'Sidebar',
  'settings.appearance.themeCustom.field.player': 'Player',
  'settings.appearance.themeCustom.field.field': 'Field',
  'settings.appearance.themeCustom.field.row': 'Row',
  'settings.appearance.themeCustom.field.rowHover': 'Row Hover',
  'settings.appearance.themeCustom.field.rowActive': 'Selected Row',
  'settings.appearance.themeCustom.field.chip': 'Chip',
  'settings.appearance.themeCustom.field.focus': 'Focus Ring',
  'settings.appearance.themeCustom.field.success': 'Success',
  'settings.appearance.themeCustom.field.warning': 'Warning',
  'settings.appearance.themeCustom.field.danger': 'Danger',
  'settings.appearance.themeCustom.field.cornerRadius': 'Corner Radius',
  'settings.appearance.themeCustom.field.panelBlur': 'Panel Blur',
  'settings.appearance.themeCustom.field.saturation': 'Saturation',
  'settings.appearance.themeCustom.field.motionEnabled': 'Enable Motion',
  'settings.appearance.themeCustom.field.motionSpeed': 'Motion Speed',
  'settings.appearance.themeCustom.field.motionIntensity': 'Motion Intensity',
  'settings.appearance.themeCustom.field.appBg.description': 'Main window base color',
  'settings.appearance.themeCustom.field.appBg2.description': 'Soft middle stop of the background gradient',
  'settings.appearance.themeCustom.field.appBg3.description': 'End stop of the background gradient',
  'settings.appearance.themeCustom.field.panel.description': 'Frosted panel tint',
  'settings.appearance.themeCustom.field.panelSoft.description': 'Sidebar and softer panels',
  'settings.appearance.themeCustom.field.accent.description': 'Main interactions',
  'settings.appearance.themeCustom.field.accentStrong.description': 'Gradient and depth',
  'settings.appearance.themeCustom.field.secondary.description': 'Highlight accents',
  'settings.appearance.themeCustom.field.heading.description': 'Titles and primary copy',
  'settings.appearance.themeCustom.field.text.description': 'Body text, artists, and settings copy',
  'settings.appearance.themeCustom.field.muted.description': 'Supporting copy',
  'settings.appearance.themeCustom.field.border.description': 'Card borders and dividers',
  'settings.appearance.themeCustom.field.onAccent.description': 'Text on accent buttons',
  'settings.appearance.themeCustom.field.buttonText.description': 'Regular buttons and chips',
  'settings.appearance.themeCustom.field.panelOpacity.description': 'How much background shows through panels',
  'settings.appearance.themeCustom.field.glass.description': 'Blur and glass layering',
  'settings.appearance.themeCustom.field.shadow.description': 'Cards, popups, and player shadows',
  'settings.appearance.themeCustom.field.titlebar.description': 'Top window bar background',
  'settings.appearance.themeCustom.field.sidebar.description': 'Left navigation and softer layers',
  'settings.appearance.themeCustom.field.player.description': 'Bottom player background',
  'settings.appearance.themeCustom.field.field.description': 'Inputs and search fields',
  'settings.appearance.themeCustom.field.row.description': 'Normal list row background',
  'settings.appearance.themeCustom.field.rowHover.description': 'Hovered list row background',
  'settings.appearance.themeCustom.field.rowActive.description': 'Selected list row background',
  'settings.appearance.themeCustom.field.chip.description': 'Filter chips and small buttons',
  'settings.appearance.themeCustom.field.focus.description': 'Keyboard focus and outline highlight',
  'settings.appearance.themeCustom.field.success.description': 'Success state notices',
  'settings.appearance.themeCustom.field.warning.description': 'Warning state notices',
  'settings.appearance.themeCustom.field.danger.description': 'Danger action notices',
  'settings.appearance.themeCustom.field.cornerRadius.description': 'Panel and button radius',
  'settings.appearance.themeCustom.field.panelBlur.description': 'Glass panel blur radius',
  'settings.appearance.themeCustom.field.saturation.description': 'Overall UI color strength',
  'settings.appearance.themeCustom.field.motionEnabled.description': 'Only writes CSS transition variables',
  'settings.appearance.themeCustom.field.motionSpeed.description': 'CSS animation duration',
  'settings.appearance.themeCustom.field.motionIntensity.description': 'CSS movement and emphasis strength',
  'settings.appearance.themeCustom.preview.title': 'Editing',
  'settings.appearance.themeCustom.preview.description': 'Changes preview live and are saved only when you click save.',
  'settings.appearance.themeCustom.myThemes.title': 'My Themes',
  'settings.appearance.themeCustom.myThemes.description': 'Save, switch, duplicate, import, and export safe theme parameters.',
  'settings.appearance.themeCustom.myThemes.empty': 'No custom themes yet.',
  'settings.appearance.themeCustom.group.core': 'Common Colors',
  'settings.appearance.themeCustom.group.core.description': 'Old-ECHO-style palette controls for the most visible colors.',
  'settings.appearance.themeCustom.group.gradient': 'Background Gradient',
  'settings.appearance.themeCustom.group.gradient.description': 'Controls the old-ECHO-style window gradient mood.',
  'settings.appearance.themeCustom.group.surface': 'Surface',
  'settings.appearance.themeCustom.group.surface.description': 'Titlebar, sidebar, player, and list layers.',
  'settings.appearance.themeCustom.group.state': 'State',
  'settings.appearance.themeCustom.group.state.description': 'Success, warning, danger, and focus colors.',
  'settings.appearance.themeCustom.group.motion': 'Motion',
  'settings.appearance.themeCustom.group.motion.description': 'CSS variables only, without runtime timers.',
  'settings.appearance.themeCustom.group.advanced': 'Advanced Details',
  'settings.appearance.themeCustom.group.advanced.description': 'Fine tune text, borders, and button text colors.',
  'settings.appearance.themeCustom.message.created': 'My theme was created.',
  'settings.appearance.themeCustom.message.copied': 'Copied to the target tone. Save to keep it.',
  'settings.appearance.themeCustom.message.exported': 'Theme parameters were exported.',
  'settings.appearance.themeCustom.message.imported': 'Theme parameters were imported and applied.',
  'settings.appearance.themeCustom.message.importFailed': 'Import failed. Choose an ECHO theme parameter JSON file.',
  'settings.appearance.themeCustom.message.fixed': 'Text and button colors were adjusted.',
  'settings.appearance.themeCustom.message.invalidColor': 'Use a safe #RRGGBB color.',
  'settings.appearance.themeCustom.message.lowContrast': 'Text contrast is low and may affect readability. You can auto-fix it or adjust text colors.',
  'settings.appearance.themeCustom.message.reset': 'Custom colors for this theme were reset.',
  'settings.appearance.themeCustom.message.saved': 'Custom colors for this theme were saved.',
  'settings.appearance.density.title': 'Interface Density',
  'settings.appearance.density.description': 'Library lists use a tighter desktop density instead of oversized card rows.',
  'settings.appearance.density.compact': 'Compact',
  'settings.appearance.density.standard': 'Standard',
  'settings.appearance.artistAvatars.action.clear': 'Clear Avatar Cache',
  'settings.appearance.artistAvatars.action.queueing': 'Queueing...',
  'settings.appearance.artistAvatars.action.refreshMissing': 'Refresh Missing Avatars',
  'settings.appearance.artistAvatars.description': 'Fetch real artist avatars slowly in the background and reuse local cached images on the artist wall.',
  'settings.appearance.artistAvatars.fallback': 'Use artist album artwork when no avatar is found',
  'settings.appearance.artistAvatars.message.cleared': 'Cleared {removedRows} avatar records and {deletedFiles} files.',
  'settings.appearance.artistAvatars.message.desktopBridgeClear': 'Desktop bridge unavailable. Open ECHO Next in Electron to clear artist avatars.',
  'settings.appearance.artistAvatars.message.desktopBridgeRefresh': 'Desktop bridge unavailable. Open ECHO Next in Electron to refresh artist avatars.',
  'settings.appearance.artistAvatars.message.enableFirst': 'Enable automatic artist avatar fetching first.',
  'settings.appearance.artistAvatars.message.queued': 'Queued {queued} artist avatars. Skipped {skipped}.',
  'settings.appearance.artistAvatars.title': 'Artist Avatars',
  'settings.appearance.artistAvatars.toggle': 'Auto Fetch Artist Avatars',
  'settings.appearance.albumCoverShape.title': 'Album Cover Shape',
  'settings.appearance.albumCoverShape.description': 'Show album artwork with rounded or square corners. This preference overrides theme presets. Rounded is the default.',
  'settings.appearance.albumCoverShape.rounded': 'Rounded',
  'settings.appearance.albumCoverShape.square': 'Square',
  'settings.appearance.font.choose': 'Choose',
  'settings.appearance.font.chinese.description': 'Used first when the main font does not include Chinese glyphs.',
  'settings.appearance.font.chinese.title': 'Chinese Font',
  'settings.appearance.font.fallback.description': 'The third and lowest-priority interface font group, used to continue filling missing glyphs.',
  'settings.appearance.font.fallback.title': 'Fallback Font',
  'settings.appearance.font.main.description': 'ECHO uses bundled Monocraft and ZCOOL Happy by default. You can enter any installed font family.',
  'settings.appearance.font.main.title': 'Main Font',
  'settings.appearance.fontSize.description': 'Adjust the base size used by the interface.',
  'settings.appearance.fontSize.title': 'Base Font Size',
  'settings.appearance.lineHeight.description': 'Adjust default UI text spacing for denser or airier reading.',
  'settings.appearance.lineHeight.title': 'Interface Line Height',
  'settings.appearance.reset.action': 'Reset',
  'settings.appearance.reset.description': 'Restore Monocraft, ZCOOL Happy, base size, line height, text depth, and rounded covers.',
  'settings.appearance.reset.title': 'Appearance Defaults',
  'settings.appearance.textDepth.description': 'Adjust interface text darkness. Lower values make text lighter.',
  'settings.appearance.textDepth.title': 'Text Depth',
  'settings.devices.title': 'Device List',
  'settings.devices.empty': 'echo-audio-host has not returned output devices yet.',
  'settings.about.devMode.title': 'Developer Mode',
  'settings.about.devMode.description': 'Currently validating ECHO Next Phase 1: Library Core + Audio Host.',
  'settings.about.nativeSqlite.title': 'Native SQLite',
  'settings.about.nativeSqlite.description': 'better-sqlite3 is rebuilt to the Electron ABI before dev to avoid module mismatches during scanning.',
  'settings.about.audioHost.title': 'Audio Host',
  'settings.about.audioHost.description': 'echo-audio-host.exe is currently used for local migration validation. Production builds will ship it through extraResources.',
  'settings.about.version.title': 'Version',
  'settings.about.version.description': 'The currently installed ECHO Next version.',
  'settings.about.updates.title': 'Automatic Updates',
  'settings.about.updates.description': 'Check GitHub Release automatically after launch, then restart and install after the download completes.',
  'settings.about.updates.currentVersion': 'Current Version',
  'settings.about.updates.latestVersion': 'Latest Version',
  'settings.about.updates.status': 'Status',
  'settings.about.updates.lastChecked': 'Last Checked',
  'settings.about.updates.autoCheck': 'Automatically Check For Updates',
  'settings.about.updates.action.check': 'Check For Updates',
  'settings.about.updates.action.checking': 'Checking...',
  'settings.about.updates.action.afdian': 'Afdian',
  'settings.about.updates.action.history': 'View Update History',
  'settings.about.updates.action.qq': 'Join QQ Group',
  'settings.about.updates.action.discord': 'Join Discord',
  'settings.about.updates.progress.ready': 'Download complete, preparing to install',
  'settings.about.updates.progress.downloading': 'Downloading update',
  'settings.about.updates.progress.aria': 'OTA update download progress {percent}%',
  'settings.about.updates.releaseNotes': 'Release Notes',
  'settings.about.updates.releaseNotesPending': 'Release notes will appear shortly...',
  'settings.about.updates.releaseNotesEmpty': 'Release notes will appear after GitHub Release returns release notes.',
  'settings.about.updates.state.idle': 'Pending Check',
  'settings.about.updates.state.checking': 'Checking',
  'settings.about.updates.state.available': 'New version available',
  'settings.about.updates.state.downloading': 'Downloading',
  'settings.about.updates.state.downloaded': 'Downloaded, installing',
  'settings.about.updates.state.notAvailable': 'Up To Date',
  'settings.about.updates.state.error': 'Check Failed',
  'settings.about.updates.state.disabled': 'Disabled',
  'settings.danger.database.kicker': 'Library Database Safety',
  'settings.danger.database.title': 'Recovery Assistant',
  'settings.danger.database.badge.quarantined': 'Quarantined',
  'settings.danger.database.description.loading': 'Reading the database health state, healthy snapshots, and recent maintenance records.',
  'settings.danger.database.description.quarantined': 'The library was quarantined because of damaged embedded tags or oversized text. ECHO will open the recovery flow first, and no music files will be deleted.',
  'settings.danger.database.description.healthy': 'The current database check is healthy. Healthy snapshots, bad-database archives, and recent maintenance records are kept here.',
  'settings.danger.database.description.unrecoverable': 'The database cannot be restored from a healthy snapshot. Music files will not be deleted. Export diagnostics and inspect the protection folder first, then confirm archiving the bad database and rebuilding an empty library.',
  'settings.danger.database.description.recoverable': 'When the database is unavailable, ECHO tries restoring from a healthy snapshot first. The current database is archived before recovery, and music files are not deleted.',
  'settings.danger.database.health.ok': 'Healthy',
  'settings.danger.database.health.corrupt': 'Possibly Corrupt',
  'settings.danger.database.health.unreadable': 'Unreadable',
  'settings.danger.database.health.idle': 'Pending Check',
  'settings.danger.database.steps.quarantined.1': 'The current library has been moved out of the active location, and ECHO will not keep reading those risky tags.',
  'settings.danger.database.steps.quarantined.2': 'Prefer "Repair Quarantined Copy" first. It only touches the archived copy and restores it only after validation passes.',
  'settings.danger.database.steps.quarantined.3': 'If repair fails, then choose to restore a healthy snapshot or archive the bad database and rebuild an empty library. Music files will not be deleted.',
  'settings.danger.database.steps.unrecoverable.1': 'First confirm that no library scan is running. Recovery, rebuild, and delete actions are rejected while scanning.',
  'settings.danger.database.steps.unrecoverable.2': 'Export diagnostics and open the protection folder first so the bad-database archive trail is preserved.',
  'settings.danger.database.steps.unrecoverable.3': 'After entering the confirmation phrase "rebuild empty library", archive the bad database, rebuild an empty library, then add your library folders again and rescan.',
  'settings.danger.database.steps.recoverable.1': 'First confirm that no library scan is running. Recovery, rebuild, and delete actions are rejected while scanning.',
  'settings.danger.database.steps.recoverable.2': 'Try "Restore Latest Healthy Snapshot" first. It only accepts snapshots enumerated by the main process.',
  'settings.danger.database.steps.recoverable.3': 'If no healthy snapshot exists, or recovery still leaves corruption, use "Archive Bad Database And Rebuild Empty Library".',
  'settings.danger.database.action.check': 'Check Health',
  'settings.danger.database.action.checking': 'Checking...',
  'settings.danger.database.action.create': 'Create Healthy Snapshot',
  'settings.danger.database.action.creating': 'Creating...',
  'settings.danger.database.action.restore': 'Restore Latest Healthy Snapshot',
  'settings.danger.database.action.restoring': 'Restoring...',
  'settings.danger.database.action.scrub': 'Repair Quarantined Copy',
  'settings.danger.database.action.scrubbing': 'Repairing...',
  'settings.danger.database.action.rebuild': 'Archive Bad Database And Rebuild Empty Library',
  'settings.danger.database.action.rebuilding': 'Rebuilding...',
  'settings.danger.database.action.discard': 'Archive Problem Tracks',
  'settings.danger.database.action.discarding': 'Archiving...',
  'settings.danger.database.action.relaunch': 'Restart Into Recovery Mode',
  'settings.danger.database.action.relaunching': 'Restarting...',
  'settings.danger.database.action.open': 'Open Protection Folder',
  'settings.danger.database.action.export': 'Export Diagnostics',
  'settings.danger.database.action.exporting': 'Exporting...',
  'settings.danger.database.meta.current': 'Current Database',
  'settings.danger.database.meta.snapshot': 'Latest Healthy Snapshot',
  'settings.danger.database.meta.snapshotHint': 'Can be created manually',
  'settings.danger.database.meta.archive': 'Latest Bad-Database Archive',
  'settings.danger.database.meta.archiveHint': 'Automatically archived before recovery or rebuild',
  'settings.danger.database.meta.pending': 'Pending Load',
  'settings.danger.database.meta.noSnapshot': 'No Healthy Snapshot Yet',
  'settings.danger.database.meta.noArchive': 'No Bad-Database Archive Yet',
  'settings.danger.database.unavailable.scrub': 'No repairable quarantined copy was found. Open the protection folder to confirm the archive exists, or export diagnostics directly.',
  'settings.danger.database.unavailable.restore': 'There is no healthy snapshot available to restore. You can create one first. If the current library is unavailable, export diagnostics.',
  'settings.danger.database.confirmWord': 'Danger Confirmation Phrase',
  'settings.danger.database.confirmPlaceholder': 'Enter the confirmation phrase shown by the button before running dangerous actions',
  'settings.danger.database.scanRunning': 'A library scan is still running. Recovery, rebuild, and delete actions are blocked until the scan finishes.',
  'settings.danger.duplicates.title': 'Scan And Clean Duplicate Songs',
  'settings.danger.duplicates.description': 'Scan and list duplicate groups first. Cleanup prioritizes lower-quality, lower-score copies into the system recycle bin, while keeping the highest-scored track in each group.',
  'settings.danger.duplicates.meta.result': 'Scan Result',
  'settings.danger.duplicates.meta.resultValue': '{groups} groups / {tracks} tracks to clean',
  'settings.danger.duplicates.meta.release': 'Estimated Release',
  'settings.danger.duplicates.meta.scanTime': 'Scan Time',
  'settings.danger.duplicates.meta.notScanned': 'Not Scanned Yet',
  'settings.danger.duplicates.action.scan': 'Scan Duplicate Songs',
  'settings.danger.duplicates.action.scanning': 'Scanning...',
  'settings.danger.duplicates.action.clean': 'Clean Scan Result',
  'settings.danger.duplicates.action.cleaning': 'Cleaning...',
  'settings.danger.duplicates.progress.scan.title': 'Scanning Duplicate Songs',
  'settings.danger.duplicates.progress.scan.description': 'Processing in batches to avoid disrupting playback',
  'settings.danger.duplicates.progress.scan.aria': 'Duplicate song scan in progress',
  'settings.danger.duplicates.progress.clean.title': 'Cleaning Scan Result',
  'settings.danger.duplicates.progress.clean.description': 'Moving files to the recycle bin and updating the library index',
  'settings.danger.duplicates.progress.clean.aria': 'Duplicate song cleanup in progress',
  'settings.danger.clearCache.title': 'Clear Library Cache',
  'settings.danger.clearCache.description': 'Removes the library index, scan records, and cover cache without deleting music files or library folders.',
};

export const translations: Record<Locale, TranslationMap> = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'ja-JP': jaJP,
  'en-US': enUS,
};

export const isLocale = (value: string | null): value is Locale => {
  return value === 'zh-CN' || value === 'zh-TW' || value === 'ja-JP' || value === 'en-US';
};
