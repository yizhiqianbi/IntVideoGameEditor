package top.xumeng.app.shell

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import top.xumeng.app.BuildConfig
import top.xumeng.app.core.account.SiteSession
import top.xumeng.app.feature.player.VideoCatalog
import top.xumeng.app.feature.web.WebRoutes

enum class ShellTab { PLAY, VIDEO, CHAT, CREATE, PROFILE, FORUM, NOVELS, PUBLISH, GENERATE, VOICE, TASKS, RECHARGE, INVITE, PRESETS, SETTINGS }

data class ChatFocus(val id: String, val name: String, val opening: Int = 0, val fresh: Boolean = false)

class ShellViewModel(private val saved: SavedStateHandle) : ViewModel() {
    val origin: String = BuildConfig.WEB_ORIGIN
    private val session = SiteSession(origin)
    val signedIn = session.signedInFlow

    var tab by mutableStateOf(readTab(saved.get<String>(TAB)))
        private set
    var overlayUrl by mutableStateOf(saved.get<String>(OVERLAY))
        private set
    var chatUrl by mutableStateOf(saved.get<String>(CHAT) ?: WebRoutes.hash(origin, "chat"))
        private set
    var profileUrl by mutableStateOf(saved.get<String>(PROFILE) ?: WebRoutes.hash(origin, "profile"))
        private set
    var focusedDramaId by mutableStateOf(saved.get<String>(DRAMA))
        private set
    var chatFocus by mutableStateOf<ChatFocus?>(null)
        private set
    var forumFocus by mutableStateOf<String?>(null)
        private set
    var threadOpen by mutableStateOf(false)
        private set

    init { session.refresh() }

    fun refreshSession() { session.refresh() }

    fun select(next: ShellTab, resetSection: Boolean = true) {
        tab = next
        overlayUrl = null
        chatFocus = null
        forumFocus = null
        if (resetSection) focusedDramaId = null
        if (next != ShellTab.CHAT) threadOpen = false
        persist()
    }

    fun openCharacter(id: String, name: String, opening: Int = 0, fresh: Boolean = false) {
        tab = ShellTab.CHAT
        overlayUrl = null
        chatFocus = ChatFocus(id, name, opening, fresh)
        persist()
    }

    fun consumeChatFocus() { chatFocus = null }

    fun openForum(id: String) {
        if (id.isBlank()) return
        tab = ShellTab.FORUM
        overlayUrl = null
        forumFocus = id
        persist()
    }

    fun consumeForumFocus() { forumFocus = null }

    fun noteThread(open: Boolean) { threadOpen = open }

    fun back(): Boolean {
        if (tab == ShellTab.CHAT && threadOpen) return true
        return false
    }

    fun openOverlay(url: String) {
        overlayUrl = url
        persist()
    }

    fun closeOverlay() {
        overlayUrl = null
        persist()
    }

    fun consumeDramaFocus() {
        focusedDramaId = null
        persist()
    }

    fun applyExternalUrl(url: String) {
        val fragment = WebRoutes.fragment(url)
        val path = WebRoutes.path(url)
        when {
            WebRoutes.characterPathId(path) != null -> openCharacter(WebRoutes.characterPathId(path)!!, "")
            fragment.startsWith("character/") -> openCharacter(fragment.removePrefix("character/"), "")
            fragment == "videos" -> select(ShellTab.VIDEO)
            fragment.startsWith("videos/") -> {
                val id = fragment.removePrefix("videos/")
                select(ShellTab.VIDEO)
                focusedDramaId = id.takeIf { VideoCatalog.isDrama(it) }
                persist()
            }
            fragment == "chat" || fragment.startsWith("chat/") -> {
                chatUrl = url
                select(ShellTab.CHAT, resetSection = false)
            }
            fragment.isEmpty() || fragment == "characters" -> select(ShellTab.PLAY)
            fragment == "studio" || fragment.startsWith("studio/") -> select(ShellTab.CREATE)
            fragment == "novels" || fragment.startsWith("novels/") -> select(ShellTab.NOVELS)
            fragment == "generation" -> select(ShellTab.GENERATE)
            fragment == "forum" -> select(ShellTab.FORUM)
            fragment == "voice" -> select(ShellTab.VOICE)
            fragment == "tasks" -> select(ShellTab.TASKS)
            fragment == "recharge" || fragment == "vip" -> select(ShellTab.RECHARGE)
            fragment == "invite" -> select(ShellTab.INVITE)
            fragment == "presets" -> select(ShellTab.PRESETS)
            fragment == "settings" -> select(ShellTab.SETTINGS)
            fragment == "profile" || fragment.startsWith("author/") -> select(ShellTab.PROFILE)
            else -> select(ShellTab.PLAY)
        }
    }

    private fun persist() {
        saved[TAB] = tab.name.lowercase()
        if (overlayUrl == null) saved.remove<String>(OVERLAY) else saved[OVERLAY] = overlayUrl
        saved[CHAT] = chatUrl
        saved[PROFILE] = profileUrl
        if (focusedDramaId == null) saved.remove<String>(DRAMA) else saved[DRAMA] = focusedDramaId
    }

    private companion object {
        const val TAB = "shellTab"
        const val OVERLAY = "shellOverlay"
        const val CHAT = "shellChat"
        const val PROFILE = "shellProfile"
        const val DRAMA = "shellDrama"

        fun readTab(value: String?): ShellTab = when (value) {
            "drama", "video" -> ShellTab.VIDEO
            "chat" -> ShellTab.CHAT
            "create", "studio" -> ShellTab.CREATE
            "profile" -> ShellTab.PROFILE
            "forum" -> ShellTab.FORUM
            "novels" -> ShellTab.NOVELS
            "publish" -> ShellTab.PUBLISH
            "generation", "generate" -> ShellTab.GENERATE
            "voice" -> ShellTab.VOICE
            "tasks" -> ShellTab.TASKS
            "recharge" -> ShellTab.RECHARGE
            "invite" -> ShellTab.INVITE
            "presets" -> ShellTab.PRESETS
            "settings" -> ShellTab.SETTINGS
            "plaza", "play" -> ShellTab.PLAY
            else -> ShellTab.PLAY
        }
    }
}
