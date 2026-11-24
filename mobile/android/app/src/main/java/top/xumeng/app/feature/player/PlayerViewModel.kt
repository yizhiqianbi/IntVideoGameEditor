package top.xumeng.app.feature.player

import android.app.Application
import androidx.annotation.OptIn
import androidx.core.net.toUri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import top.xumeng.app.BuildConfig
import top.xumeng.app.core.network.XumengApi
import top.xumeng.app.core.network.XumengHttp

sealed class PlayerUi {
    data object Loading : PlayerUi()
    data class Ready(val dramas: List<DramaTitle>) : PlayerUi()
    data class Failed(val message: String) : PlayerUi()
}

@OptIn(UnstableApi::class)
class PlayerViewModel(app: Application) : AndroidViewModel(app) {
    val origin: String = BuildConfig.WEB_ORIGIN
    private val backend = XumengApi.get(origin)
    private val uiFlow = MutableStateFlow<PlayerUi>(PlayerUi.Loading)
    val ui: StateFlow<PlayerUi> = uiFlow.asStateFlow()
    private val unlockedFlow = MutableStateFlow<Set<String>>(emptySet())
    val unlocked: StateFlow<Set<String>> = unlockedFlow.asStateFlow()
    private val pendingFlow = MutableStateFlow<String?>(null)
    val pendingEpisode: StateFlow<String?> = pendingFlow.asStateFlow()
    private val noticeFlow = MutableStateFlow("")
    val notice: StateFlow<String> = noticeFlow.asStateFlow()
    private val positionFlow = MutableStateFlow(0L)
    val position: StateFlow<Long> = positionFlow.asStateFlow()
    private val durationFlow = MutableStateFlow(0L)
    val duration: StateFlow<Long> = durationFlow.asStateFlow()
    private val progress = WatchProgressStore(app)
    private val shelf = VideoShelf(app)
    private val marksFlow = MutableStateFlow(shelf.marks())
    val marks: StateFlow<VideoMarks> = marksFlow.asStateFlow()
    private val notesFlow = MutableStateFlow(shelf.notes())
    val notes: StateFlow<List<VideoNote>> = notesFlow.asStateFlow()
    private val choice = mutableMapOf<String, String>()
    var index by mutableIntStateOf(0)
        private set
    var category by mutableStateOf("")
        private set
    var tick by mutableIntStateOf(0)
        private set
    private var boundUrl: String? = null
    private var boundEpisodeId: String? = null
    private var boundDramaId: String? = null
    private var resumedUrl: String? = null
    private var lastProgressWrite = 0L
    private var userPaused = false
    private var generation = 0

    val player: ExoPlayer = ExoPlayer.Builder(app)
        .setMediaSourceFactory(
            DefaultMediaSourceFactory(
                DefaultHttpDataSource.Factory()
                    .setUserAgent(XumengHttp.userAgent)
                    .setConnectTimeoutMs(20_000)
                    .setReadTimeoutMs(30_000)
                    .setAllowCrossProtocolRedirects(false),
            ),
        )
        .build()
        .also { it.repeatMode = Player.REPEAT_MODE_OFF }

    init {
        player.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                if (playbackState == Player.STATE_READY) resumeSaved()
                if (playbackState == Player.STATE_ENDED) finishEpisode()
            }
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (!isPlaying) rememberProgress(force = true)
            }
        })
        viewModelScope.launch {
            while (isActive) {
                positionFlow.value = player.currentPosition.coerceAtLeast(0L)
                val length = player.duration
                durationFlow.value = if (length > 0) length else 0L
                rememberProgress(force = false)
                delay(250)
            }
        }
        refresh()
    }

    fun refresh() {
        val token = ++generation
        uiFlow.value = PlayerUi.Loading
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) { runCatching { loadCatalog() } }
            if (token != generation) return@launch
            result.fold(
                onSuccess = { dramas ->
                    val shown = feed(dramas)
                    if (index > shown.lastIndex) index = 0
                    uiFlow.value = if (dramas.isEmpty()) PlayerUi.Failed("还没有可播放的短剧。") else PlayerUi.Ready(dramas)
                    if (shown.isNotEmpty()) {
                        play(clipAt(shown, index))
                        loadUnlocks(shown[index].dramaId)
                    }
                },
                onFailure = { uiFlow.value = PlayerUi.Failed("短剧目录暂时读不出来。") },
            )
        }
    }

    fun feed(dramas: List<DramaTitle>): List<DramaTitle> =
        if (category.isEmpty()) dramas else dramas.filter { it.category == category }

    fun chooseCategory(next: String, dramas: List<DramaTitle>) {
        if (next == category) return
        category = next
        val shown = feed(dramas)
        index = 0
        pendingFlow.value = null
        if (shown.isEmpty()) {
            player.pause()
            return
        }
        play(clipAt(shown, 0))
        loadUnlocks(shown[0].dramaId)
    }

    fun focus(dramaId: String?, dramas: List<DramaTitle>) {
        if (dramaId.isNullOrEmpty()) return
        category = ""
        val found = dramas.indexOfFirst { it.dramaId == dramaId }
        if (found >= 0) moveTo(found, dramas)
    }

    fun moveTo(next: Int, dramas: List<DramaTitle>) {
        if (dramas.isEmpty()) return
        index = next.coerceIn(0, dramas.lastIndex)
        pendingFlow.value = null
        play(clipAt(dramas, index))
        loadUnlocks(dramas[index].dramaId)
    }

    fun selectEpisode(drama: DramaTitle, episodeId: String) {
        val episode = drama.episodes.find { it.id == episodeId } ?: return
        val open = episode.number == 1 || episode.id in unlockedFlow.value
        if (!open) {
            pendingFlow.value = episode.id
            noticeFlow.value = ""
            player.pause()
            return
        }
        pendingFlow.value = null
        choice[drama.dramaId] = episode.id
        tick += 1
        play(PlayableClip(drama.dramaId, episode.id, drama.title, episode.label, drama.category, episode.mediaUrl, drama.posterUrl))
    }

    fun seekFraction(fraction: Float) {
        val length = player.duration
        if (length <= 0) return
        val target = (fraction.coerceIn(0f, 1f) * length).toLong()
        player.seekTo(target)
        positionFlow.value = target
        rememberProgress(force = true)
    }

    fun toggleLike(dramaId: String) { marksFlow.value = shelf.toggle("likes", dramaId) }

    fun toggleSave(dramaId: String) { marksFlow.value = shelf.toggle("saves", dramaId) }

    fun addNote(dramaId: String, body: String) { notesFlow.value = shelf.addNote(dramaId, body) }

    fun payPending(drama: DramaTitle) {
        val episodeId = pendingFlow.value ?: return
        viewModelScope.launch {
            noticeFlow.value = ""
            val paid = runCatching { withContext(Dispatchers.IO) { backend.ensureSession(); backend.unlockEpisode(episodeId) } }
            paid.fold(
                onSuccess = {
                    unlockedFlow.value = unlockedFlow.value + episodeId
                    pendingFlow.value = null
                    noticeFlow.value = "已使用 50 Credit"
                    selectEpisode(drama, episodeId)
                },
                onFailure = { error -> noticeFlow.value = error.message ?: "这一集暂时不能打开" },
            )
        }
    }

    fun clipAt(dramas: List<DramaTitle>, at: Int): PlayableClip {
        val drama = dramas[at.coerceIn(0, dramas.lastIndex)]
        val chosen = drama.episodes.find { it.id == choice[drama.dramaId] } ?: drama.episodes.first()
        val episode = if (chosen.number == 1 || chosen.id in unlockedFlow.value) chosen else drama.episodes.first { it.number == 1 }
        return PlayableClip(drama.dramaId, episode.id, drama.title, episode.label, drama.category, episode.mediaUrl, drama.posterUrl)
    }

    private fun loadUnlocks(dramaId: String) {
        viewModelScope.launch {
            val ids = runCatching { withContext(Dispatchers.IO) { backend.ensureSession(); backend.videoUnlocks(dramaId) } }.getOrDefault(emptySet())
            val current = (uiFlow.value as? PlayerUi.Ready)?.dramas?.getOrNull(index)?.dramaId
            if (current == dramaId) unlockedFlow.value = ids
        }
    }

    fun pauseForLifecycle() { player.pause() }

    fun resumeIfWanted() {
        if (!userPaused && player.mediaItemCount > 0) player.play()
    }

    fun toggle() {
        if (player.isPlaying) {
            userPaused = true
            player.pause()
        } else {
            userPaused = false
            player.play()
        }
    }

    private fun play(clip: PlayableClip) {
        val url = clip.mediaUrl
        if (!url.startsWith("https://video.xumengchat.top/media/")) return
        val same = boundUrl == url && boundEpisodeId == clip.episodeId && player.playbackState != Player.STATE_IDLE
        boundUrl = url
        boundEpisodeId = clip.episodeId
        boundDramaId = clip.dramaId
        userPaused = false
        if (same) {
            player.play()
            return
        }
        resumedUrl = null
        positionFlow.value = 0L
        durationFlow.value = 0L
        player.setMediaItem(MediaItem.fromUri(url.toUri()))
        player.prepare()
        player.play()
    }

    private fun resumeSaved() {
        val url = boundUrl ?: return
        val episodeId = boundEpisodeId ?: return
        if (resumedUrl == url) return
        val length = player.duration
        if (length <= 0) return
        resumedUrl = url
        val saved = progress.read(episodeId) ?: return
        val ms = (saved.seconds * 1000).toLong()
        if (saved.seconds >= 5 && ms < length - 2_000) {
            player.seekTo(ms)
            positionFlow.value = ms
            val message = "从 ${clock(ms)} 继续"
            noticeFlow.value = message
            viewModelScope.launch {
                delay(2_200)
                if (noticeFlow.value == message) noticeFlow.value = ""
            }
        }
    }

    private fun finishEpisode() {
        val episodeId = boundEpisodeId ?: return
        val dramas = (uiFlow.value as? PlayerUi.Ready)?.dramas ?: return
        val shown = feed(dramas)
        if (shown.isEmpty()) return
        progress.clear(episodeId)
        val drama = shown[index.coerceIn(0, shown.lastIndex)]
        val at = drama.episodes.indexOfFirst { it.id == episodeId }
        val next = drama.episodes.getOrNull(at + 1)
        if (next != null && (next.number == 1 || next.id in unlockedFlow.value)) {
            selectEpisode(drama, next.id)
            return
        }
        if (index < shown.lastIndex) moveTo(index + 1, shown)
    }

    private fun rememberProgress(force: Boolean) {
        val episodeId = boundEpisodeId ?: return
        val dramaId = boundDramaId ?: return
        val length = player.duration
        val position = player.currentPosition
        if (length <= 0 || position <= 0 || player.playbackState == Player.STATE_ENDED) return
        val now = System.currentTimeMillis()
        if (!force && now - lastProgressWrite < 3_000) return
        lastProgressWrite = now
        progress.write(WatchMark(dramaId, episodeId, position / 1000.0, length / 1000.0, now))
    }

    private fun clock(ms: Long): String {
        val total = (ms / 1000).toInt()
        return "%d:%02d".format(total / 60, total % 60)
    }

    private fun loadCatalog(): List<DramaTitle> {
        val urls = listOf(
            "$origin/assets/xumeng/video-catalog.json",
            "$origin/api/xumeng-video/catalog",
        )
        var last: Exception? = null
        for (url in urls) {
            try {
                return VideoCatalog.parse(XumengHttp.getText(origin, url, 6 * 1024 * 1024))
            } catch (error: Exception) {
                last = error
            }
        }
        throw last ?: IllegalStateException("视频目录暂时读不出来。")
    }

    override fun onCleared() {
        rememberProgress(force = true)
        player.release()
    }
}
