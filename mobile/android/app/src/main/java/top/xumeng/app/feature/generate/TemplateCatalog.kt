package top.xumeng.app.feature.generate

import android.content.res.AssetManager
import org.json.JSONObject

data class ShelfGroup(val id: String, val label: String)

data class ShelfStyle(val id: String, val label: String)

data class ShelfTemplate(
    val id: String,
    val kind: String,
    val label: String,
    val english: String,
    val group: String,
    val ratio: String,
    val frame: String,
    val free: Boolean = false,
)

data class TemplateShelf(val groups: List<ShelfGroup>, val styles: List<ShelfStyle>, val stills: List<ShelfTemplate>, val videos: List<ShelfTemplate>) {
    fun find(id: String): ShelfTemplate? = (stills + videos).find { it.id == id }

    fun visible(kind: String, group: String, query: String): List<ShelfTemplate> {
        val pool = if (kind == "video") videos else stills
        val terms = query.trim().lowercase().split(Regex("\\s+")).filter { it.isNotEmpty() }
        return pool.filter { item ->
            val groupLabel = groups.find { it.id == item.group }?.label.orEmpty()
            (group.isEmpty() || item.group == group || item.free) &&
                terms.all { term ->
                    listOf(item.label, item.english, item.frame, item.id, groupLabel).any { field -> field.lowercase().contains(term) }
                }
        }
    }
}

object TemplateCatalog {
    private var cached: TemplateShelf? = null

    fun load(assets: AssetManager): TemplateShelf {
        cached?.let { return it }
        val root = JSONObject(assets.open("generation-templates.json").bufferedReader().use { it.readText() })
        val shelf = TemplateShelf(
            groups = array(root, "groups") { ShelfGroup(it.getString("id"), it.getString("label")) },
            styles = array(root, "styles") { ShelfStyle(it.getString("id"), it.getString("label")) },
            stills = array(root, "stills") { template(it) },
            videos = array(root, "videos") { template(it) },
        )
        cached = shelf
        return shelf
    }

    private fun template(item: JSONObject) = ShelfTemplate(
        id = item.getString("id"),
        kind = item.getString("kind"),
        label = item.getString("label"),
        english = item.optString("english"),
        group = item.optString("group"),
        ratio = item.optString("ratio"),
        frame = item.optString("frame"),
        free = item.optBoolean("free"),
    )

    private fun <T> array(root: JSONObject, name: String, map: (JSONObject) -> T): List<T> {
        val values = root.optJSONArray(name) ?: return emptyList()
        return buildList {
            for (index in 0 until values.length()) values.optJSONObject(index)?.let { add(map(it)) }
        }
    }
}

fun demoPath(template: ShelfTemplate): String? =
    if (template.id.startsWith("h3-")) "/assets/xumeng/h3-actions/${template.id}.mp4" else null

fun posterPath(template: ShelfTemplate): String? = when {
    template.free -> null
    template.id.startsWith("h3-") -> "/assets/xumeng/h3-actions/${template.id}.webp"
    template.id.startsWith("krea2-") -> "/assets/xumeng/krea2-actions/${template.id}.webp"
    else -> null
}

fun compileTemplate(template: ShelfTemplate, note: String): String {
    val extra = note.trim()
    if (extra.length > 1000) throw IllegalArgumentException("补充最多 1000 字")
    val base = if (template.kind == "video") videoPrompt(template.frame) else if (template.free) "画面里是自愿的成年人。$extra" else stillPrompt(template.frame)
    if (template.free && extra.length < 2) throw IllegalArgumentException("先写一点画面")
    val result = if (!template.free && extra.isNotEmpty()) "$base\n补充要求：$extra" else base
    if (result.length > 4000) throw IllegalArgumentException("模板内容过长，请缩短后再试")
    return result
}

private fun stillPrompt(frame: String) = listOf(
    "主体：参考图中的成年人物是唯一要保留身份的人，并且是自愿的成年人。脸、发型、肤色、五官和年龄外观来自参考图。",
    "画面：模板图提供姿势、服装、房间和光线。把参考图中的人放进模板图，替换模板里原来的人。$frame",
    "单张静帧。参考图不是构图底图；构图跟随模板图，脸从这一帧起就是参考图。",
    "模板图里若还有另一个身体，那个身体只保留模板图的姿势和接触，不把模板图的脸安到主体上。",
    "无文字、无水印、无面部漂移、无身份更换、无多余手指、无手指粘连、无穿模、无油腻皮肤、无畸形生殖器、无未成年人、无幼态面孔、无校服。",
).joinToString("\n")

private fun videoPrompt(action: String) = listOf(
    "规格：5秒 | 24fps | 写实连续单镜头 | 9:16。同一空间、连续时间、一条运镜；无内部切镜、无跳切、无蒙太奇、无黑场。",
    "主体：Image 1 中的成年人物是唯一要保留身份的人。脸、发型、肤色、五官和年龄外观从第一帧到最后一帧都来自 Image 1。Video 1 提供姿势、服装、房间、光线和动作。",
    "时间轴：",
    "0–2秒：先站住。姿势、服装、房间和机位沿用 Video 1 的开头。脸上已经是 Image 1 的人。",
    "动作：${action}一个连贯镜头。",
    "中间：接触、方向和重量跟随 Video 1。脸和发型始终是 Image 1。",
    "末1–2秒：停在 Video 1 结束时的静止姿势，不再开新动作。脸、发型和身份仍是 Image 1。",
    "镜头：跟随 Video 1，一个景别加一种连续运镜，不切镜。",
    "场景：沿用 Video 1 的房间、服装和光线。",
    "声音：只保留现场的身体与环境声，无旁白，无突然出现的背景音乐。",
    "风格：写实真人，自愿的成年人，21岁以上。",
    "光线：沿用 Video 1。",
    "连续性：把 Image 1 的人放进 Video 1，替换模板里原来的人。Image 1 不是第一帧照片；第一帧已经是 Video 1 的姿势，脸从第一帧起就是 Image 1。Video 1 原来的脸、发型和身份不要留下来。画面里若还有另一个身体，那个身体只保留 Video 1 的姿势和接触，不把 Video 1 的脸安到主体上。",
    "无字幕、无水印、无面部漂移、无身份更换、无多余手指、无手指粘连、无穿模、无油腻皮肤、无畸形生殖器、无未成年人、无幼态面孔、无校服。",
).joinToString("\n")
