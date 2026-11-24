package top.xumeng.app.core.account

import android.webkit.CookieManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Reads the site session cookie the WebView already stores.
 * Native screens do not collect passwords or start a second login.
 */
class SiteSession(private val origin: String) {
    private val signedIn = MutableStateFlow(false)
    val signedInFlow: StateFlow<Boolean> = signedIn.asStateFlow()

    fun refresh() {
        signedIn.value = hasSession()
    }

    fun hasSession(): Boolean {
        val raw = runCatching { CookieManager.getInstance().getCookie(origin) }.getOrNull().orEmpty()
        return raw.split(';').any { part ->
            val cookie = part.trim()
            cookie.startsWith("dzmm_session=") && cookie.removePrefix("dzmm_session=").isNotEmpty()
        }
    }
}
