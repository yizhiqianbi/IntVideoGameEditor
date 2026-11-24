package top.xumeng.app.feature.player

import android.content.Context
import org.json.JSONObject

data class WatchMark(val dramaId: String, val episodeId: String, val seconds: Double, val duration: Double, val updatedAt: Long)

/** Local watch positions, same shape and limits as the site's xumeng-video-progress record. */
class WatchProgressStore(context: Context) {
    private val prefs = context.getSharedPreferences("xumeng-video-progress", Context.MODE_PRIVATE)

    fun read(episodeId: String): WatchMark? = load()[episodeId]

    fun write(mark: WatchMark) {
        if (mark.episodeId.isBlank() || mark.dramaId.isBlank() || !mark.seconds.isFinite() || mark.seconds < 0) return
        val next = load().toMutableMap()
        next[mark.episodeId] = mark
        val trimmed = next.values.sortedByDescending { it.updatedAt }.take(200)
        val json = JSONObject()
        trimmed.forEach { item ->
            json.put(item.episodeId, JSONObject()
                .put("dramaId", item.dramaId)
                .put("episodeId", item.episodeId)
                .put("currentTime", item.seconds)
                .put("duration", item.duration)
                .put("updatedAt", item.updatedAt))
        }
        prefs.edit().putString(KEY, json.toString()).apply()
    }

    fun clear(episodeId: String) {
        val next = load().toMutableMap()
        if (next.remove(episodeId) == null) return
        val json = JSONObject()
        next.values.forEach { item ->
            json.put(item.episodeId, JSONObject()
                .put("dramaId", item.dramaId)
                .put("episodeId", item.episodeId)
                .put("currentTime", item.seconds)
                .put("duration", item.duration)
                .put("updatedAt", item.updatedAt))
        }
        prefs.edit().putString(KEY, json.toString()).apply()
    }

    private fun load(): Map<String, WatchMark> {
        val raw = prefs.getString(KEY, null) ?: return emptyMap()
        val root = runCatching { JSONObject(raw) }.getOrNull() ?: return emptyMap()
        return buildMap {
            val names = root.keys()
            while (names.hasNext()) {
                val episodeId = names.next()
                val item = root.optJSONObject(episodeId) ?: continue
                if (item.optString("episodeId") != episodeId) continue
                val dramaId = item.optString("dramaId")
                val seconds = item.optDouble("currentTime", Double.NaN)
                val duration = item.optDouble("duration", 0.0)
                val updatedAt = item.optLong("updatedAt")
                if (dramaId.isBlank() || !seconds.isFinite() || seconds < 0) continue
                put(episodeId, WatchMark(dramaId, episodeId, seconds, duration, updatedAt))
            }
        }
    }

    private companion object {
        const val KEY = "marks"
    }
}
