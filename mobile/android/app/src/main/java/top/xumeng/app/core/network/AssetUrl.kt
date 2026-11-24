package top.xumeng.app.core.network

import java.net.URI

/** Turns a catalog path into an absolute URL the same way the site rewrites covers. */
object AssetUrl {
    fun resolve(origin: String, raw: String?): String? {
        val value = raw?.trim().orEmpty()
        if (value.isEmpty() || value.length > 500 || value.any { it.code < 0x20 }) return null
        val rewritten = when {
            value.startsWith("/api/dzmm/backend/") -> "/api/backend/" + value.removePrefix("/api/dzmm/backend/")
            value.startsWith("/dzmm/") -> "/assets/xumeng/" + value.removePrefix("/dzmm/")
            else -> value
        }
        val absolute = when {
            rewritten.startsWith("https://") || rewritten.startsWith("http://") -> rewritten
            rewritten.startsWith("/") -> origin.trimEnd('/') + rewritten
            else -> return null
        }
        val uri = runCatching { URI(absolute) }.getOrNull() ?: return null
        val scheme = uri.scheme?.lowercase() ?: return null
        if (scheme != "https" && scheme != "http") return null
        if (uri.host.isNullOrEmpty() || uri.rawUserInfo != null) return null
        return if (AllowedUrl.accepts(origin, absolute)) absolute else null
    }
}
