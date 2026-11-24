package top.xumeng.app.feature.feed

import org.json.JSONObject
import top.xumeng.app.core.network.AssetUrl
import java.io.IOException

data class CatalogCard(
    val id: String,
    val name: String,
    val author: String,
    val heat: String,
    val cover: String?,
    val tags: List<String> = emptyList(),
    val authorId: String = "",
)

data class CatalogPage(
    val cards: List<CatalogCard>,
    val total: Int,
    val offset: Int,
    val limit: Int,
    val hasMore: Boolean,
)

/** Binds the public card payload: characters[].id, name, author, heat, cover, plus page fields. */
object CatalogJson {
    fun parse(json: String, origin: String): CatalogPage {
        val root = try {
            JSONObject(json)
        } catch (_: Exception) {
            throw IOException("目录格式无效")
        }
        if (!root.has("characters") || root.isNull("characters")) throw IOException("目录缺少角色列表")
        val array = root.optJSONArray("characters") ?: throw IOException("目录缺少角色列表")
        val cards = buildList {
            for (index in 0 until array.length()) {
                val item = array.optJSONObject(index) ?: continue
                val id = item.optString("id", "").trim()
                val name = item.optString("name", "").trim()
                if (id.isEmpty() || name.isEmpty() || id.length > 120 || name.length > 200) continue
                val tags = buildList {
                    val values = item.optJSONArray("tags") ?: return@buildList
                    for (cursor in 0 until values.length()) {
                        val tag = values.optString(cursor).trim()
                        if (tag.isNotEmpty() && tag.length <= 40) add(tag)
                        if (size == 100) break
                    }
                }
                add(
                    CatalogCard(
                        id = id,
                        name = name,
                        author = item.optString("author", "").trim().take(80),
                        heat = item.optString("heat", "").trim().take(32),
                        cover = AssetUrl.resolve(origin, item.optString("cover", "")),
                        tags = tags,
                        authorId = item.optJSONObject("publication")?.optString("authorId").orEmpty().trim().take(120),
                    ),
                )
            }
        }
        val offset = root.optInt("offset", 0).coerceAtLeast(0)
        val limit = root.optInt("limit", 24).coerceIn(1, 50)
        val total = root.optInt("total", cards.size).coerceAtLeast(0)
        val hasMore = if (root.has("hasMore") && !root.isNull("hasMore")) root.optBoolean("hasMore") else offset + limit < total
        return CatalogPage(cards, total, offset, limit, hasMore && cards.isNotEmpty())
    }
}
