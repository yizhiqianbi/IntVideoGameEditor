package top.xumeng.app.feature.player

import org.json.JSONObject
import java.io.IOException

data class PlayableClip(
    val dramaId: String,
    val episodeId: String,
    val title: String,
    val episode: String,
    val category: String,
    val mediaUrl: String,
    val posterUrl: String?,
)

data class DramaEpisode(val id: String, val number: Int, val label: String, val mediaUrl: String)

data class DramaTitle(
    val dramaId: String,
    val title: String,
    val category: String,
    val posterUrl: String?,
    val episodes: List<DramaEpisode>,
    val characterId: String = "",
    val synopsis: String = "",
    val tags: List<String> = emptyList(),
)

/** Same media keys as src/lib/xumeng-video-catalog.ts. Episode 1 is free; later episodes follow the site unlock list. */
object VideoCatalog {
    private const val mediaOrigin = "https://video.xumengchat.top"
    private val dramaId = Regex("^hg-([0-9]{4,8})$")
    private val itemId = Regex("^hg-([0-9]{4,8})-([0-9]{1,3})$")
    private val mediaKey = Regex("^video/huangguo/([0-9]{4,8})/ep-([0-9]{3})\\.mp4$")
    private val posterKey = Regex("^posters/huangguo/([0-9]{4,8})\\.(?:jpg|jpeg|png)$")

    fun isDrama(id: String): Boolean = dramaId.matches(id)

    fun parse(json: String): List<DramaTitle> {
        val root = try {
            JSONObject(json)
        } catch (_: Exception) {
            throw IOException("视频目录格式无效")
        }
        val items = root.optJSONArray("items") ?: throw IOException("视频目录格式无效")
        val order = LinkedHashMap<String, MutableList<Draft>>()
        for (index in 0 until items.length()) {
            val item = items.optJSONObject(index) ?: continue
            val clip = clipFrom(item) ?: continue
            order.getOrPut(clip.dramaId) { mutableListOf() }.add(clip)
        }
        return order.mapNotNull { (_, drafts) ->
            val episodes = drafts.distinctBy { it.id }.sortedBy { it.episodeNumber }
            val opener = episodes.firstOrNull { it.episodeNumber == 1 } ?: return@mapNotNull null
            DramaTitle(
                opener.dramaId,
                opener.title,
                opener.category,
                opener.posterUrl,
                episodes.map { DramaEpisode(it.id, it.episodeNumber, it.episode, it.mediaUrl) },
                drafts.firstOrNull { it.characterId.isNotBlank() }?.characterId.orEmpty(),
                drafts.firstOrNull { it.synopsis.isNotBlank() }?.synopsis.orEmpty(),
                drafts.firstOrNull { it.tags.isNotEmpty() }?.tags.orEmpty(),
            )
        }
    }

    private fun clipFrom(item: JSONObject): Draft? {
        val id = text(item, "id", 24)
        val drama = text(item, "dramaId", 16)
        val title = text(item, "title", 120)
        val episode = text(item, "episode", 40)
        val media = text(item, "mediaKey", 80)
        val poster = text(item, "posterKey", 80)
        val category = text(item, "category", 40)
        val characterId = text(item, "characterId", 80)
        val synopsis = text(item, "synopsis", 400).ifBlank { text(item, "description", 400) }
        val tags = buildList {
            val values = item.optJSONArray("tags") ?: return@buildList
            for (cursor in 0 until values.length()) {
                val tag = values.optString(cursor).trim().removePrefix("#")
                if (tag.isNotEmpty() && tag.length <= 16 && tag.indexOf('\u0000') < 0) add(tag)
                if (size == 4) break
            }
        }
        val dramaMatch = dramaId.matchEntire(drama) ?: return null
        val itemMatch = itemId.matchEntire(id) ?: return null
        val mediaMatch = mediaKey.matchEntire(media) ?: return null
        val posterMatch = posterKey.matchEntire(poster) ?: return null
        if (title.isEmpty() || episode.isEmpty()) return null
        val series = dramaMatch.groupValues[1]
        if (itemMatch.groupValues[1] != series || mediaMatch.groupValues[1] != series || posterMatch.groupValues[1] != series) return null
        val number = mediaMatch.groupValues[2].toIntOrNull() ?: return null
        return Draft(id, drama, title, episode, category, number, mediaUrl(media), posterUrl(poster), characterId, synopsis, tags)
    }

    private fun mediaUrl(key: String) = "$mediaOrigin/media/$key?v=3"
    private fun posterUrl(key: String) = "$mediaOrigin/covers/${key.removePrefix("posters/")}?v=2"

    private fun text(item: JSONObject, name: String, max: Int): String {
        val value = item.optString(name, "").trim()
        if (value.isEmpty() || value.length > max || value.indexOf('\u0000') >= 0) return ""
        return value
    }

    private data class Draft(
        val id: String,
        val dramaId: String,
        val title: String,
        val episode: String,
        val category: String,
        val episodeNumber: Int,
        val mediaUrl: String,
        val posterUrl: String,
        val characterId: String,
        val synopsis: String,
        val tags: List<String>,
    )
}
