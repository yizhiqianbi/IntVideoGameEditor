package top.xumeng.app.feature.player

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class VideoMarks(val likes: List<String> = emptyList(), val saves: List<String> = emptyList())

data class VideoNote(val id: String, val dramaId: String, val body: String, val at: Long)

/** Likes, saves, and comments stay on the device, matching the site's local video marks and notes. */
class VideoShelf(context: Context) {
    private val prefs = context.getSharedPreferences("xumeng-video-shelf", Context.MODE_PRIVATE)
    private val dramaId = Regex("^hg-[0-9]{4,8}$")

    fun marks(): VideoMarks {
        val raw = runCatching { JSONObject(prefs.getString(MARKS, "") ?: "") }.getOrNull() ?: return VideoMarks()
        return VideoMarks(ids(raw.optJSONArray("likes")), ids(raw.optJSONArray("saves")))
    }

    fun notes(): List<VideoNote> {
        val raw = runCatching { JSONArray(prefs.getString(NOTES, "") ?: "") }.getOrNull() ?: return emptyList()
        return buildList {
            for (index in 0 until raw.length()) {
                val item = raw.optJSONObject(index) ?: continue
                val id = item.optString("id").trim()
                val drama = item.optString("dramaId").trim()
                val body = item.optString("body").trim()
                if (id.length in 1..40 && dramaId.matches(drama) && body.isNotEmpty() && body.length <= 120) {
                    add(VideoNote(id, drama, body, item.optLong("at")))
                }
                if (size == 80) break
            }
        }
    }

    fun toggle(kind: String, drama: String): VideoMarks {
        if (!dramaId.matches(drama) || (kind != "likes" && kind != "saves")) return marks()
        val current = marks()
        val source = if (kind == "likes") current.likes else current.saves
        val next = if (drama in source) source.filterNot { it == drama } else listOf(drama) + source
        val trimmed = next.distinct().take(400)
        val updated = if (kind == "likes") current.copy(likes = trimmed) else current.copy(saves = trimmed)
        prefs.edit().putString(MARKS, JSONObject().put("likes", JSONArray(updated.likes)).put("saves", JSONArray(updated.saves)).toString()).apply()
        return updated
    }

    fun addNote(drama: String, text: String): List<VideoNote> {
        val body = text.trim().take(120)
        if (!dramaId.matches(drama) || body.isEmpty()) return notes()
        val note = VideoNote("$drama-${System.currentTimeMillis()}".take(40), drama, body, System.currentTimeMillis())
        val next = listOf(note) + notes().filter { it.id != note.id }.take(79)
        val array = JSONArray()
        next.forEach { item ->
            array.put(JSONObject().put("id", item.id).put("dramaId", item.dramaId).put("body", item.body).put("at", item.at))
        }
        prefs.edit().putString(NOTES, array.toString()).apply()
        return next
    }

    private fun ids(array: JSONArray?): List<String> {
        if (array == null) return emptyList()
        return buildList {
            for (index in 0 until array.length()) {
                val id = array.optString(index)
                if (dramaId.matches(id)) add(id)
                if (size == 400) break
            }
        }
    }

    private companion object {
        const val MARKS = "marks"
        const val NOTES = "notes"
    }
}
