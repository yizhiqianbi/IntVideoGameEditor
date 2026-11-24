package top.xumeng.app.core.network

import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.UUID

/** Same limits and messages as src/lib/xumeng-scenarios.ts. Draft save only; room routes are separate. */
object ScenarioRules {
    const val MAX_SAFE = 9007199254740991L
    const val MAX_BYTES = 192 * 1024
    const val MAX_DRAFT_BYTES = MAX_BYTES - 2048

    private val idPattern = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$")
    private val draftKeys = setOf("id", "title", "synopsis", "world", "goal", "opening", "dmPrompt", "hostNotes", "roles", "stages")
    private val metaKeys = setOf("version", "createdAt", "updatedAt")
    private val roleKeys = setOf("id", "name", "description", "personality")
    private val stageKeys = setOf("id", "title", "location", "objective")

    fun create(template: Boolean): ScenarioDraft {
        val id = UUID.randomUUID().toString()
        if (!template) return ScenarioDraft(id, "", "", "", "", "", "", "", emptyList(), emptyList())
        return ScenarioDraft(
            id = id,
            title = "雾港灯塔的失落航图",
            synopsis = "与同伴核对航线、寻找失落航图，在船离港前作出选择。",
            world = "一座近代海港。所有角色均为成年人；海上没有魔法，旧航图需要以测量记录核实。故事时间、位置与线索以主持已发布的事件为准。",
            goal = "确认两条航线中哪条仍可通行，决定是否把证据交给船长。玩家可以放弃航行或寻找第三条路线。",
            opening = "暮色里的雾港灯塔刚刚点亮。港务员把一张缺了半边的航图摊在桌上：明早离港的船需要确认航线。你们可以先查看旧航志、到码头询问船长，或去灯塔寻找测量记录。",
            dmPrompt = "作为团本主持，只使用已发布的事件和玩家已知线索推进。尊重角色能力与玩家行动，提供可介入的局势；不要代替玩家决定行动。只给出准备发布的叙事，不列作者提示词或未揭露的笔记。",
            hostNotes = "未揭露信息：灯塔的记录显示东侧礁石近期升出水面。只有核对记录后才能确认危险，不能把未知线索当作玩家已知事实。完成调查后换到码头，旧桌面和港务员不再每轮出现。",
            roles = listOf(
                ScenarioRole("cartographer", "修图师", "目标是交付可靠航图，擅长测量；不擅长判断船况。", "谨慎而直率，先核对来源再作判断。"),
                ScenarioRole("navigator", "领航员", "熟悉海湾，想保护船员；愿意询问码头同行，仍需要核实传言。", "保护同行，愿意交叉询问而非相信第一条传言。"),
            ),
            stages = listOf(
                ScenarioStage("harbor", "核对线索", "港务工坊", "选择调查方法，记录来源与尚未确认的信息。"),
                ScenarioStage("lighthouse", "调查灯塔", "旧灯塔", "取得测量记录，决定是否共同承担核对风险。"),
                ScenarioStage("dock", "船长的决定", "码头", "根据已核实信息选择航线或放弃，保留每个选择的后果。"),
            ),
        )
    }

    fun prepare(draft: ScenarioDraft): ScenarioDraft {
        if (draft.roles.size > 8 || draft.stages.size > 20) throw IOException("最多设置 8 个角色位、20 个阶段。")
        val checked = ScenarioDraft(
            id = id(draft.id),
            title = text(draft.title, "标题", 120),
            synopsis = text(draft.synopsis, "简介", 2000),
            world = text(draft.world, "世界设定", 20000),
            goal = text(draft.goal, "目标", 4000),
            opening = text(draft.opening, "开场", 12000),
            dmPrompt = text(draft.dmPrompt, "主持提示词", 12000),
            hostNotes = text(draft.hostNotes, "主持笔记", 20000),
            roles = draft.roles.map { role ->
                ScenarioRole(
                    id(role.id),
                    text(role.name, "角色名", 80),
                    text(role.description, "角色描述", 4000),
                    text(role.personality, "角色性格与秘密", 4000),
                )
            },
            stages = draft.stages.map { stage ->
                ScenarioStage(
                    id(stage.id),
                    text(stage.title, "阶段名", 120),
                    text(stage.location, "地点", 240),
                    text(stage.objective, "阶段目标", 4000),
                )
            },
            version = draft.version,
            createdAt = draft.createdAt,
            updatedAt = draft.updatedAt,
        )
        unique(checked.roles.map { it.id })
        unique(checked.stages.map { it.id })
        if (utf8Bytes(draftJson(checked)) > MAX_DRAFT_BYTES) throw IOException("团本内容过大，请减少篇幅。")
        return checked
    }

    fun readiness(draft: ScenarioDraft): List<String> = buildList {
        if (draft.title.isBlank()) add("填写团本标题")
        if (draft.opening.isBlank()) add("填写玩家可以接续的开场")
        if (draft.goal.isBlank()) add("填写任务目标")
        if (draft.roles.size < 2) add("至少设置两个角色位")
        if (draft.roles.any { it.name.isBlank() }) add("为每个角色位命名")
        if (draft.stages.isEmpty()) add("至少设置一个阶段")
        if (draft.stages.any { it.title.isBlank() }) add("为每个阶段命名")
    }

    fun sameContent(left: ScenarioDraft, right: ScenarioDraft): Boolean = draftJson(left) == draftJson(right)

    fun summary(draft: ScenarioDraft): ScenarioSummary {
        val version = draft.version ?: throw IOException("版本无效。")
        return ScenarioSummary(draft.id, draft.title, draft.synopsis, version, draft.updatedAt, draft.roles.size.toLong(), draft.stages.size.toLong())
    }

    fun requestBody(accountId: String, draft: ScenarioDraft, version: Long?): String {
        val scenario = draftJson(draft)
        val account = quote(accountId)
        return if (version == null) "{\"accountId\":$account,\"scenario\":$scenario}"
        else "{\"accountId\":$account,\"scenario\":$scenario,\"version\":$version}"
    }

    fun list(root: JSONObject, accountId: String): List<ScenarioSummary> {
        val items = root.optJSONArray("scenarios")
        if (raw(root, "accountId") != accountId || items == null || items.length() > 200) throw IOException("团本列表返回无效。")
        return List(items.length()) { index ->
            val item = items.optJSONObject(index) ?: throw IOException("团本摘要无效。")
            ScenarioSummary(
                id = id(raw(item, "id")),
                title = text(raw(item, "title"), "标题", 120),
                synopsis = text(raw(item, "synopsis"), "简介", 2000),
                version = jsonLong(raw(item, "version"), "版本", 1),
                updatedAt = jsonLong(raw(item, "updatedAt"), "更新时间", 0),
                roleCount = jsonLong(raw(item, "roleCount"), "角色数", 0),
                stageCount = jsonLong(raw(item, "stageCount"), "阶段数", 0),
            )
        }
    }

    fun detail(root: JSONObject, accountId: String): ScenarioDraft {
        val scenario = root.optJSONObject("scenario")
        if (raw(root, "accountId") != accountId || scenario == null) throw IOException("团本返回的账号无效。")
        rejectUnknown(scenario, draftKeys + metaKeys)
        val rolesValue = raw(scenario, "roles")
        val stagesValue = raw(scenario, "stages")
        if (rolesValue !is JSONArray || rolesValue.length() > 8 || stagesValue !is JSONArray || stagesValue.length() > 20) {
            throw IOException("最多设置 8 个角色位、20 个阶段。")
        }
        val parsed = prepare(
            ScenarioDraft(
                id = id(raw(scenario, "id")),
                title = text(raw(scenario, "title"), "标题", 120),
                synopsis = text(raw(scenario, "synopsis"), "简介", 2000),
                world = text(raw(scenario, "world"), "世界设定", 20000),
                goal = text(raw(scenario, "goal"), "目标", 4000),
                opening = text(raw(scenario, "opening"), "开场", 12000),
                dmPrompt = text(raw(scenario, "dmPrompt"), "主持提示词", 12000),
                hostNotes = text(raw(scenario, "hostNotes"), "主持笔记", 20000),
                roles = List(rolesValue.length()) { index -> readRole(rolesValue.opt(index)) },
                stages = List(stagesValue.length()) { index -> readStage(stagesValue.opt(index)) },
            ),
        )
        return parsed.copy(
            version = jsonLong(raw(scenario, "version"), "版本", 1),
            createdAt = jsonLong(raw(scenario, "createdAt"), "创建时间", 0),
            updatedAt = jsonLong(raw(scenario, "updatedAt"), "更新时间", 0),
        )
    }

    fun id(value: Any?): String {
        if (value !is String || !idPattern.matches(value)) throw IOException("团本编号无效。")
        return value
    }

    fun switched(body: JSONObject?, accountId: String): Boolean {
        if (body == null || !body.has("accountId")) return false
        return raw(body, "accountId") != accountId
    }

    fun transport(error: Throwable): String {
        val message = error.message.orEmpty()
        if (message.startsWith("请求失败")) return "操作失败，输入仍保留，请刷新后重试。"
        if (message.any { it.code > 127 }) return message
        if (message.isBlank()) return "操作失败，输入仍保留，请刷新后重试。"
        return "团本服务无法连接，输入仍保留，请重试。"
    }

    private fun readRole(value: Any?): ScenarioRole {
        if (value !is JSONObject) throw IOException("角色位格式无效。")
        rejectUnknown(value, roleKeys)
        return ScenarioRole(
            id(raw(value, "id")),
            text(raw(value, "name"), "角色名", 80),
            text(raw(value, "description"), "角色描述", 4000),
            text(raw(value, "personality"), "角色性格与秘密", 4000),
        )
    }

    private fun readStage(value: Any?): ScenarioStage {
        if (value !is JSONObject) throw IOException("阶段格式无效。")
        rejectUnknown(value, stageKeys)
        return ScenarioStage(
            id(raw(value, "id")),
            text(raw(value, "title"), "阶段名", 120),
            text(raw(value, "location"), "地点", 240),
            text(raw(value, "objective"), "阶段目标", 4000),
        )
    }

    private fun text(value: Any?, label: String, max: Int): String {
        if (value !is String || value.length > max || '\u0000' in value) throw IOException("${label}无效或过长。")
        return value
    }

    private fun unique(ids: List<String>) {
        if (ids.size != ids.toSet().size) throw IOException("角色位或阶段编号重复。")
    }

    private fun rejectUnknown(value: JSONObject, allowed: Set<String>) {
        val keys = value.keys()
        while (keys.hasNext()) {
            if (keys.next() !in allowed) throw IOException("团本包含不支持的字段，请检查导入格式。")
        }
    }

    private fun raw(item: JSONObject, key: String): Any? {
        if (!item.has(key) || item.isNull(key)) return null
        return item.get(key)
    }

    private fun jsonLong(value: Any?, label: String, minimum: Long): Long {
        val number = when (value) {
            is Int -> value.toLong()
            is Long -> value
            is Double -> {
                if (value.isNaN() || value.isInfinite() || value % 1.0 != 0.0 || value > MAX_SAFE.toDouble()) throw IOException("${label}无效。")
                value.toLong()
            }
            else -> throw IOException("${label}无效。")
        }
        if (number < minimum || number > MAX_SAFE) throw IOException("${label}无效。")
        return number
    }

    private fun draftJson(draft: ScenarioDraft): String = buildString {
        append("{\"id\":").append(quote(draft.id))
        append(",\"title\":").append(quote(draft.title))
        append(",\"synopsis\":").append(quote(draft.synopsis))
        append(",\"world\":").append(quote(draft.world))
        append(",\"goal\":").append(quote(draft.goal))
        append(",\"opening\":").append(quote(draft.opening))
        append(",\"dmPrompt\":").append(quote(draft.dmPrompt))
        append(",\"hostNotes\":").append(quote(draft.hostNotes))
        append(",\"roles\":[")
        draft.roles.forEachIndexed { index, role ->
            if (index > 0) append(',')
            append("{\"id\":").append(quote(role.id))
            append(",\"name\":").append(quote(role.name))
            append(",\"description\":").append(quote(role.description))
            append(",\"personality\":").append(quote(role.personality))
            append('}')
        }
        append("],\"stages\":[")
        draft.stages.forEachIndexed { index, stage ->
            if (index > 0) append(',')
            append("{\"id\":").append(quote(stage.id))
            append(",\"title\":").append(quote(stage.title))
            append(",\"location\":").append(quote(stage.location))
            append(",\"objective\":").append(quote(stage.objective))
            append('}')
        }
        append("]}")
    }

    private fun quote(value: String): String = buildString(value.length + 2) {
        append('"')
        for (ch in value) {
            when (ch) {
                '"' -> append("\\\"")
                '\\' -> append("\\\\")
                '\b' -> append("\\b")
                '\u000C' -> append("\\f")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> if (ch.code < 0x20) append("\\u%04x".format(ch.code)) else append(ch)
            }
        }
        append('"')
    }

    private fun utf8Bytes(value: String): Int = value.toByteArray(Charsets.UTF_8).size
}

data class ScenarioRole(val id: String, val name: String, val description: String, val personality: String)

data class ScenarioStage(val id: String, val title: String, val location: String, val objective: String)

data class ScenarioDraft(
    val id: String,
    val title: String,
    val synopsis: String,
    val world: String,
    val goal: String,
    val opening: String,
    val dmPrompt: String,
    val hostNotes: String,
    val roles: List<ScenarioRole>,
    val stages: List<ScenarioStage>,
    val version: Long? = null,
    val createdAt: Long = 0,
    val updatedAt: Long = 0,
)

data class ScenarioSummary(
    val id: String,
    val title: String,
    val synopsis: String,
    val version: Long,
    val updatedAt: Long,
    val roleCount: Long,
    val stageCount: Long,
)
