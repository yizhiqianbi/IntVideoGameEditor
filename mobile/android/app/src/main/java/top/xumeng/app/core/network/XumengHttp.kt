package top.xumeng.app.core.network

import okhttp3.OkHttpClient
import okhttp3.Request
import top.xumeng.app.BuildConfig
import top.xumeng.app.NavigationPolicy
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Public reads only. Login cookies stay in the WebView and are never copied here. */
object XumengHttp {
    val userAgent: String = "XumengAndroid/" + BuildConfig.VERSION_NAME
    val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .callTimeout(60, TimeUnit.SECONDS)
        .followRedirects(false)
        .followSslRedirects(false)
        .build()

    fun getText(origin: String, url: String, maxBytes: Int): String {
        return String(getBytes(origin, url, "application/json", maxBytes), Charsets.UTF_8).removePrefix("\uFEFF")
    }

    fun getBytes(origin: String, url: String, accept: String, maxBytes: Int): ByteArray {
        var current = url
        repeat(5) {
            if (!AllowedUrl.accepts(origin, current)) throw IOException("地址不受信任")
            val request = Request.Builder().url(current)
                .header("Accept", accept)
                .header("User-Agent", userAgent)
                .build()
            client.newCall(request).execute().use { response ->
                val code = response.code
                if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                    val location = response.header("Location") ?: throw IOException("重定向无效")
                    current = response.request.url.resolve(location)?.toString() ?: throw IOException("重定向无效")
                    return@repeat
                }
                if (code !in 200..299) throw IOException("HTTP $code")
                val body = response.body ?: throw IOException("空响应")
                return readLimited(body.byteStream(), maxBytes)
            }
        }
        throw IOException("重定向过多")
    }

    private fun readLimited(input: java.io.InputStream, maxBytes: Int): ByteArray {
        input.use { source ->
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(8192)
            var total = 0
            while (true) {
                val count = source.read(buffer)
                if (count < 0) break
                total += count
                if (total > maxBytes) throw IOException("响应过大")
                output.write(buffer, 0, count)
            }
            return output.toByteArray()
        }
    }
}

object AllowedUrl {
    fun accepts(origin: String, url: String): Boolean {
        if (NavigationPolicy.isTrusted(url, origin)) return true
        val uri = runCatching { java.net.URI(url) }.getOrNull() ?: return false
        if (!"https".equals(uri.scheme, ignoreCase = true)) return false
        if (!"video.xumengchat.top".equals(uri.host, ignoreCase = true)) return false
        if (uri.rawUserInfo != null || uri.rawFragment != null) return false
        val path = uri.rawPath ?: return false
        return path == "/catalog.json" || path.startsWith("/covers/") || path.startsWith("/media/")
    }
}
