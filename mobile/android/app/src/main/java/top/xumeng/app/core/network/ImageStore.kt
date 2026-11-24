package top.xumeng.app.core.network

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

object ImageStore {
    private val cache = object : LruCache<String, Bitmap>(24 * 1024) {
        override fun sizeOf(key: String, value: Bitmap): Int = value.byteCount / 1024
    }

    suspend fun load(origin: String, url: String?, maxPx: Int): Bitmap? {
        if (url.isNullOrEmpty() || !AllowedUrl.accepts(origin, url)) return null
        cache.get(url)?.let { return it }
        return withContext(Dispatchers.IO) {
            cache.get(url)?.let { return@withContext it }
            val bytes = runCatching {
                XumengHttp.getBytes(origin, url, "image/*,*/*;q=0.8", 8 * 1024 * 1024)
            }.getOrNull() ?: return@withContext null
            val bitmap = decode(bytes, maxPx) ?: return@withContext null
            cache.put(url, bitmap)
            bitmap
        }
    }

    private fun decode(bytes: ByteArray, maxPx: Int): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sample = 1
        val limit = maxPx.coerceAtLeast(1)
        while (bounds.outWidth / sample > limit * 2 && bounds.outHeight / sample > limit * 2) sample *= 2
        val options = BitmapFactory.Options().apply { inSampleSize = sample }
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
    }
}
