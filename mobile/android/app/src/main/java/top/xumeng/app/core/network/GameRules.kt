package top.xumeng.app.core.network

import org.json.JSONObject
import java.io.IOException

/** Same limits and messages as src/lib/xumeng-games.ts. */
object GameRules {
    const val MAX_SAFE = 9007199254740991L
    const val MAX_SOURCE_BYTES = 8L * 1024L * 1024L
    const val MAX_BODY_BYTES = 16L * 1024L * 1024L
    const val blankSource =
        "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>新游戏</title><style>body{margin:0;background:#111116;color:#eee;font:16px/1.8 system-ui,sans-serif;min-height:100vh;display:grid;place-items:center}main{max-width:580px;padding:30px}h1{font-size:28px;line-height:1.3}button{background:#ed1763;color:white;border:0;padding:12px 20px;border-radius:8px;margin:8px 8px 8px 0;cursor:pointer;font:inherit}small{color:#aaa}#choices{margin-top:25px}</style></head><body><main><h1>我的游戏</h1><p>从这里开始。</p></main></body></html>"

    private val idPattern = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$")

    fun id(value: Any?): String {
        if (value !is String || !idPattern.matches(value)) throw IOException("游戏编号无效。")
        return value
    }

    fun text(value: Any?, name: String, maxChars: Int, required: Boolean): String {
        val message = if (required) "${name}无效，请填写后再保存。" else "${name}无效。"
        if (value !is String || '\u0000' in value || value.length > maxChars || (required && value.isBlank())) throw IOException(message)
        return value
    }

    fun fields(draft: GameDraft): GameDraft {
        val source = text(draft.source, "游戏源码", MAX_SOURCE_BYTES.toInt(), false)
        if (utf8Bytes(source) > MAX_SOURCE_BYTES) throw IOException("游戏源码超过 8 MB，请减少内容后重试。")
        return GameDraft(
            id = id(draft.id),
            title = text(draft.title, "游戏名称", 120, true),
            synopsis = text(draft.synopsis, "游戏简介", 4000, false),
            source = source,
        )
    }

    fun list(root: JSONObject, accountId: String): List<GameSummary> {
        val games = root.optJSONArray("games")
        if (root.optString("accountId") != accountId || games == null) throw IOException("游戏列表所属账号无效，请重新加载。")
        val seen = HashSet<String>()
        return buildList {
            for (index in 0 until games.length()) {
                val item = games.optJSONObject(index) ?: throw IOException("游戏列表格式无效。")
                val gameId = id(raw(item, "id"))
                if (!seen.add(gameId)) throw IOException("游戏列表出现重复编号。")
                val bytes = jsonLong(raw(item, "sourceBytes"), 0)
                if (bytes > MAX_SOURCE_BYTES) throw IOException("游戏大小无效。")
                add(
                    GameSummary(
                        id = gameId,
                        title = text(raw(item, "title"), "游戏名称", 120, true),
                        synopsis = text(raw(item, "synopsis"), "游戏简介", 4000, false),
                        sourceBytes = bytes,
                        version = jsonLong(raw(item, "version"), 1),
                        createdAt = jsonLong(raw(item, "createdAt"), 0),
                        updatedAt = jsonLong(raw(item, "updatedAt"), 0),
                    ),
                )
            }
        }
    }

    fun detail(root: JSONObject, accountId: String): GameDraft {
        val game = root.optJSONObject("game")
        if (root.optString("accountId") != accountId || game == null) throw IOException("游戏所属账号无效，请重新加载。")
        val allowed = setOf("id", "title", "synopsis", "source", "version", "createdAt", "updatedAt")
        val keys = game.keys()
        while (keys.hasNext()) {
            if (keys.next() !in allowed) throw IOException("游戏文件格式无效。")
        }
        val source = text(raw(game, "source"), "游戏源码", MAX_SOURCE_BYTES.toInt(), false)
        if (utf8Bytes(source) > MAX_SOURCE_BYTES) throw IOException("游戏源码超过 8 MB，请减少内容后重试。")
        return GameDraft(
            id = id(raw(game, "id")),
            title = text(raw(game, "title"), "游戏名称", 120, true),
            synopsis = text(raw(game, "synopsis"), "游戏简介", 4000, false),
            source = source,
            version = jsonLong(raw(game, "version"), 1),
            createdAt = jsonLong(raw(game, "createdAt"), 0),
            updatedAt = jsonLong(raw(game, "updatedAt"), 0),
        )
    }

    fun utf8Bytes(value: String): Long {
        var bytes = 0L
        var index = 0
        while (index < value.length) {
            val code = value[index].code
            when {
                code <= 0x7F -> bytes += 1
                code <= 0x7FF -> bytes += 2
                code in 0xD800..0xDBFF && index + 1 < value.length && value[index + 1].code in 0xDC00..0xDFFF -> {
                    bytes += 4
                    index += 1
                }
                else -> bytes += 3
            }
            index += 1
        }
        return bytes
    }

    fun transport(error: IOException): IOException {
        val message = error.message.orEmpty()
        if (message.startsWith("请求失败")) return IOException("游戏请求失败，当前源码已保留。")
        if (message.any { it.code > 127 }) return error
        return IOException("无法连接游戏服务，源码已保留。请导出备份后重试。")
    }

    private fun raw(item: JSONObject, key: String): Any? {
        if (!item.has(key) || item.isNull(key)) return null
        return item.get(key)
    }

    private fun jsonLong(value: Any?, minimum: Long): Long {
        val number = when (value) {
            is Int -> value.toLong()
            is Long -> value
            is Double -> {
                if (value.isNaN() || value.isInfinite() || value % 1.0 != 0.0 || value > MAX_SAFE.toDouble()) throw IOException("游戏版本或时间无效。")
                value.toLong()
            }
            else -> throw IOException("游戏版本或时间无效。")
        }
        if (number < minimum || number > MAX_SAFE) throw IOException("游戏版本或时间无效。")
        return number
    }
}

data class GameSummary(
    val id: String,
    val title: String,
    val synopsis: String,
    val version: Long,
    val createdAt: Long,
    val updatedAt: Long,
    val sourceBytes: Long,
)

data class GameDraft(
    val id: String,
    val title: String,
    val synopsis: String,
    val source: String,
    val version: Long? = null,
    val createdAt: Long = 0,
    val updatedAt: Long = 0,
)
