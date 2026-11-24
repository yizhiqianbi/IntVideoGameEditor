package top.xumeng.app.feature.web

import android.net.Uri
import java.net.URI

/** Hash routes checked against tavern-app.tsx. Published cards use the site's /c/{id} path. */
object WebRoutes {
    private val publishedId = Regex("^published-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$")
    private val characterPath = Regex("^(?:/(?:en|zh-cn|zh-tw|jp|ko))?/c/([a-z0-9][a-z0-9-]{0,119})$")
    private val profileFragments = setOf(
        "profile", "settings", "presets", "admin", "recharge", "vip", "invite", "checkin", "app",
    )

    fun hash(origin: String, route: String): String {
        val bare = origin.trimEnd('/')
        val clean = route.trim().trimStart('#')
        return "$bare/#$clean"
    }

    fun character(origin: String, id: String): String {
        val bare = origin.trimEnd('/')
        return if (publishedId.matches(id)) "$bare/c/$id" else "$bare/#character/${Uri.encode(id)}"
    }

    fun isSectionRoot(url: String): Boolean {
        val frag = fragment(url)
        return frag == "chat" || frag == "profile"
    }

    /** Keep an in-page chat or profile route when the tab is opened again. */
    fun shouldKeepCurrent(current: String, requested: String): Boolean {
        if (!isSectionRoot(requested)) return false
        val section = sectionOf(current) ?: return false
        return section == sectionOf(requested)
    }

    fun sectionOf(url: String): String? {
        val frag = fragment(url)
        if (frag == "chat" || frag.startsWith("chat/")) return "chat"
        if (frag in profileFragments || frag.startsWith("author/")) return "profile"
        return null
    }

    fun isProfileFragment(fragment: String): Boolean {
        return fragment in profileFragments || fragment.startsWith("author/")
    }

    fun characterPathId(path: String): String? = characterPath.matchEntire(path)?.groupValues?.get(1)

    fun fragment(url: String): String {
        val uri = runCatching { URI(url) }.getOrNull() ?: return ""
        return uri.rawFragment ?: ""
    }

    fun path(url: String): String {
        val uri = runCatching { URI(url) }.getOrNull() ?: return ""
        return uri.rawPath ?: ""
    }
}
