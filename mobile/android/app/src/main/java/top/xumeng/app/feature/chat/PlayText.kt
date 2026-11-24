package top.xumeng.app.feature.chat

import org.json.JSONArray
import org.json.JSONObject
import top.xumeng.app.core.network.Line
import top.xumeng.app.core.network.StoryCharacter

data class PlayField(val label: String, val value: String)

data class PlaySection(val title: String, val fields: List<PlayField>)

data class PlayChrome(
    val sections: List<PlaySection> = emptyList(),
    val panels: List<PlaySection> = emptyList(),
    val labels: List<String> = emptyList(),
)

/** Keeps author status bars and interaction panels on the same chat wire, and out of the story text. */
object PlayText {
    private val field = Regex("""^\s*(?:[-*•·]\s*)?([^：:\n。！？!?，,“”"「」]{1,16}?)\s*[：:]\s*(.+?)\s*$""")
    private val pipe = Regex("""\[([^|\]\n]{1,16})\|([^\]\n]*)]""")
    private val wrapped = Regex("""^(?:#{1,6}\s*)?[『【〖\[]\s*(.+?)\s*[』】〗\]]$""")
    private val heading = Regex("""^#{1,6}\s+(.+)$""")
    private val marker = Regex("""^\s*(?:点击查看状态栏|查看状态栏|【状态栏】|\[状态栏]|『状态栏』|状态栏[：:]?)\s*$""")
    private val bracketField = Regex("""^\s*(?:[-*•·]\s*)?([^：:\n。！？!?，,“”"「」]{1,16}?)\s*[：:]\s*\[\[([\s\S]*?)]]\s*$""")
    private val knownPartial = Regex("""^\s*(?:[-*•·]\s*)?([^：:\n。！？!?，,“”"「」]{1,16}?)\s*[：:]\s*$""")
    private val panelTail = Regex("""<xumeng-panel>[\s\S]*?(?:</xumeng-panel>|$)""")
    private val panelBlock = Regex("""<xumeng-panel>([\s\S]*?)</xumeng-panel>""")
    private val momentTail = Regex("""<xumeng-moment>[\s\S]*?(?:</xumeng-moment>|$)""")
    private val hidden = Regex("""(?i)<\s*(think|thinking|analysis|draft_notes|updatevariable|update_variable|jsonpatch|hidden|delete|status_current_variable)\b[^>]*>[\s\S]*?(?:<\s*/\s*\1\s*>|$)""")
    private val statusTag = Regex("""(?i)<\s*(status[\w-]*|statusbar|状态栏?|状态面板)\b[^>]*>([\s\S]*?)(?:<\s*/\s*\1\s*>|$)""")
    private val fence = Regex("""```[^\n]*\n?([\s\S]*?)(?:```|$)""")
    private val rule = Regex("""^[-—=*_~|:\s]{3,}$""")

    fun chrome(character: StoryCharacter?, lines: List<Line>): PlayChrome {
        val labels = labels(character?.statusBar.orEmpty())
        return PlayChrome(sections(character?.statusBar.orEmpty(), lines, labels), panels(character?.interaction.orEmpty(), lines), labels)
    }

    fun visible(text: String, role: String, labels: List<String>): String {
        if (role != "assistant") return text
        val peeled = peel(strip(text), labels)
        return peeled.ifBlank { "……" }
    }

    private fun sections(statusJson: String, lines: List<Line>, labels: List<String>): List<PlaySection> {
        val bar = runCatching { JSONObject(statusJson) }.getOrNull() ?: return emptyList()
        val template = bar.optString("template")
        val initial = bar.optString("initialState")
        if (template.isBlank() && initial.isBlank() && bar.optString("updateRules").isBlank()) return emptyList()
        val base = parse(initial.ifBlank { template })
        val live = liveValues(lines, labels)
        val seen = mutableSetOf<String>()
        val sections = base.map { section ->
            PlaySection(section.title, section.fields.map { field ->
                seen.add(field.label)
                PlayField(field.label, live[field.label] ?: field.value)
            })
        }.filter { it.fields.isNotEmpty() }.toMutableList()
        val extra = live.filterKeys { it !in seen }.map { PlayField(it.key, it.value) }
        if (extra.isNotEmpty()) {
            val last = sections.lastOrNull()
            if (last != null) sections[sections.lastIndex] = last.copy(fields = (last.fields + extra).take(40))
            else sections.add(PlaySection("", extra.take(40)))
        }
        return sections
    }

    private fun labels(statusJson: String): List<String> {
        val bar = runCatching { JSONObject(statusJson) }.getOrNull() ?: return emptyList()
        val source = listOf(bar.optString("template"), bar.optString("initialState")).filter { it.isNotBlank() }.joinToString("\n")
        return parse(source).flatMap { it.fields }.map { it.label }.distinct()
    }

    private fun liveValues(lines: List<Line>, labels: List<String>): Map<String, String> {
        val latest = lines.lastOrNull { it.role == "assistant" && it.text.isNotBlank() }?.text ?: return emptyMap()
        val marked = extract(latest)
        val fields = marked.ifEmpty { peelFields(latest, labels) }
        return fields.associate { it.label to it.value }
    }

    private fun panels(interaction: String, lines: List<Line>): List<PlaySection> {
        val template = runCatching { JSONObject(interaction) }.getOrNull()?.optJSONArray("panels") ?: return emptyList()
        val live = latestPanel(lines)
        return buildList {
            for (index in 0 until template.length()) {
                val panel = template.optJSONObject(index) ?: continue
                val title = panel.optString("title")
                val fields = panel.optJSONArray("fields") ?: continue
                val values = live?.optJSONObject("panels")?.optJSONObject(title)
                val shown = buildList {
                    for (cursor in 0 until fields.length()) {
                        val field = fields.optJSONObject(cursor) ?: continue
                        val name = field.optString("name")
                        if (name.isBlank()) continue
                        add(PlayField(name, readValue(values, name, field.optString("initial"))))
                    }
                }
                if (shown.isNotEmpty()) add(PlaySection(title, shown))
            }
        }
    }

    private fun readValue(values: JSONObject?, name: String, initial: String): String {
        if (values == null || !values.has(name) || values.isNull(name)) return initial.ifBlank { "未记录" }
        val value = when (val raw = values.opt(name)) {
            is String -> raw
            is Number -> raw.toString()
            is JSONArray -> buildList {
                for (index in 0 until raw.length()) add(raw.optString(index))
            }.filter { it.isNotBlank() }.joinToString("、")
            else -> initial
        }
        return value.trim().ifBlank { "未记录" }.take(200)
    }

    private fun latestPanel(lines: List<Line>): JSONObject? {
        var found: JSONObject? = null
        lines.forEach { line ->
            if (line.role != "assistant") return@forEach
            val raw = panelBlock.find(line.text)?.groupValues?.getOrNull(1) ?: return@forEach
            found = runCatching { JSONObject(raw.trim()) }.getOrNull() ?: found
        }
        return found
    }

    private fun strip(text: String): String {
        var body = text.replace("\r\n", "\n").replace("\r", "\n")
        body = panelTail.replace(body, "")
        body = momentTail.replace(body, "")
        body = hidden.replace(body, "")
        val blocks = mutableListOf<String>()
        body = statusTag.replace(body) { match ->
            blocks.add(match.groupValues[2])
            "\n"
        }
        body = fence.replace(body) { match ->
            val inner = match.groupValues[1]
            if (parse(inner).sumOf { it.fields.size } >= 2) {
                blocks.add(inner)
                "\n"
            } else {
                match.value
            }
        }
        val lines = body.split("\n").toMutableList()
        val markerIndex = lines.indexOfFirst { marker.matches(it.trim()) }
        if (markerIndex >= 0) {
            var cursor = markerIndex + 1
            var fields = 0
            val taken = mutableListOf<String>()
            while (cursor < lines.size) {
                val line = lines[cursor].trim()
                if (line.isEmpty()) {
                    taken.add("")
                    cursor++
                    continue
                }
                val isField = field.matches(line) || pipe.containsMatchIn(line) || wrapped.matches(line)
                if (!isField) break
                if (!wrapped.matches(line)) fields++
                taken.add(line)
                cursor++
            }
            if (fields >= 2) {
                blocks.add(0, taken.joinToString("\n"))
                body = listOf(lines.take(markerIndex).joinToString("\n").trimEnd(), lines.drop(cursor).joinToString("\n").trim())
                    .filter { it.isNotBlank() }
                    .joinToString("\n\n")
            }
        }
        return body.replace(Regex("""\n{3,}"""), "\n\n").trim()
    }

    private fun peel(text: String, labels: List<String>): String {
        if (labels.isEmpty()) return text
        val known = labels.map { cleanLabel(it) }.filter { it.isNotEmpty() }.toSet()
        val lines = text.split("\n")
        var cursor = lines.size
        while (cursor > 0 && lines[cursor - 1].isBlank()) cursor--
        val taken = mutableListOf<Int>()
        var fields = 0
        var brackets = 0
        while (cursor > 0) {
            val line = lines[cursor - 1].trim()
            if (line.isEmpty()) {
                if (taken.isEmpty()) break
                taken.add(cursor - 1)
                cursor--
                continue
            }
            if (marker.matches(line)) {
                if (fields + brackets > 0) taken.add(cursor - 1)
                break
            }
            val bracket = bracketField.find(line)
            val knownField = field.find(line)?.let { cleanLabel(it.groupValues[1]) }?.takeIf { it in known }
            if (bracket != null && cleanLabel(bracket.groupValues[1]).isNotEmpty()) {
                brackets++
                taken.add(cursor - 1)
                cursor--
                continue
            }
            if (knownField != null) {
                fields++
                taken.add(cursor - 1)
                cursor--
                continue
            }
            val partial = knownPartial.find(line)?.let { cleanLabel(it.groupValues[1]) }
            if (partial != null && partial in known && taken.isEmpty()) break
            break
        }
        if (fields < 2 && brackets < 2) return text
        val drop = taken.toSet()
        return lines.filterIndexed { index, _ -> index !in drop }.joinToString("\n").replace(Regex("""\n{3,}"""), "\n\n").trim()
    }

    private fun peelFields(text: String, labels: List<String>): List<PlayField> {
        val known = labels.map { cleanLabel(it) }.filter { it.isNotEmpty() }.toSet()
        val lines = text.replace("\r\n", "\n").split("\n")
        var cursor = lines.size
        while (cursor > 0 && lines[cursor - 1].isBlank()) cursor--
        val found = mutableListOf<PlayField>()
        while (cursor > 0) {
            val line = lines[cursor - 1].trim()
            if (line.isEmpty()) {
                if (found.isEmpty()) break
                cursor--
                continue
            }
            if (marker.matches(line)) break
            val bracket = bracketField.find(line)
            if (bracket != null) {
                val label = cleanLabel(bracket.groupValues[1])
                if (label.isEmpty()) break
                found.add(0, PlayField(label, cleanValue(bracket.groupValues[2]).ifBlank { "未记录" }))
                cursor--
                continue
            }
            val match = field.find(line)
            val label = match?.let { cleanLabel(it.groupValues[1]) }.orEmpty()
            if (match != null && label in known) {
                found.add(0, PlayField(label, cleanValue(match.groupValues[2]).ifBlank { "未记录" }))
                cursor--
                continue
            }
            break
        }
        return if (found.count { it.label in known } >= 2 || found.count { labels.isEmpty() || it.label !in known } >= 2 && found.size >= 2) found else emptyList()
    }

    private fun extract(text: String): List<PlayField> {
        val blocks = mutableListOf<String>()
        statusTag.findAll(text).forEach { blocks.add(it.groupValues[2]) }
        fence.findAll(text).forEach { match ->
            if (parse(match.groupValues[1]).sumOf { it.fields.size } >= 2) blocks.add(match.groupValues[1])
        }
        return blocks.flatMap { parse(it) }.flatMap { it.fields }
    }

    private fun parse(raw: String): List<PlaySection> {
        val sections = mutableListOf(PlaySection("", emptyList()) to mutableListOf<PlayField>())
        stripTags(raw).replace(Regex("""```[^\n]*"""), "").split("\n").forEach { rawLine ->
            val line = rawLine.trim()
            if (line.isEmpty() || rule.matches(line)) return@forEach
            val pipes = pipe.findAll(line).toList()
            if (pipes.isNotEmpty()) {
                pipes.forEach { match ->
                    sections.last().second.add(PlayField(cleanLabel(match.groupValues[1]), cleanValue(match.groupValues[2]).ifBlank { "未记录" }))
                }
                return@forEach
            }
            val title = wrapped.find(line)?.groupValues?.getOrNull(1) ?: heading.find(line)?.groupValues?.getOrNull(1)
            if (title != null) {
                val inner = cleanValue(title)
                if (inner.length <= 16 && !inner.contains('：') && !inner.contains(':')) {
                    sections.add(PlaySection(inner, emptyList()) to mutableListOf())
                    return@forEach
                }
            }
            val match = field.find(line)
            val label = match?.let { cleanLabel(it.groupValues[1]) }.orEmpty()
            if (match != null && label.isNotEmpty()) sections.last().second.add(PlayField(label, cleanValue(match.groupValues[2]).ifBlank { "未记录" }))
        }
        return sections.map { (section, fields) -> section.copy(fields = fields.filter { it.label.isNotEmpty() }.take(40)) }
            .filter { it.fields.isNotEmpty() }
            .take(12)
    }

    private fun stripTags(text: String): String = text
        .replace("\r\n", "\n")
        .replace(Regex("""(?i)<br\s*/?>"""), "\n")
        .replace(Regex("""</?[A-Za-z][^>]*>"""), "")

    private fun cleanLabel(raw: String): String = raw
        .replace(Regex("""^[\s#>*_`~\-•·]+|[\s*_`~]+$"""), "")
        .removePrefix("你的")
        .replace(Regex("""[（(][^）)]*[）)]$"""), "")
        .trim()

    private fun cleanValue(raw: String): String = raw.replace(Regex("""\*\*|__|~~|`+|\*"""), "").trim()

    /** Story text shown in the message editor. Panel and moment tails stay attached on save. */
    fun editableBody(text: String): String = stripTail(stripTail(text, "<xumeng-panel>", "</xumeng-panel>"), "<xumeng-moment>", "</xumeng-moment>")

    fun storedEdit(original: String, edited: String): String {
        val visible = editableBody(original)
        val tail = if (original.startsWith(visible)) original.substring(visible.length) else ""
        return if (tail.isNotBlank()) edited.trimEnd() + tail else edited
    }

    private fun stripTail(content: String, open: String, close: String): String {
        val start = content.indexOf(open)
        if (start < 0) {
            for (length in open.length - 1 downTo 1) {
                if (content.endsWith(open.take(length))) return content.dropLast(length).trimEnd()
            }
            return content
        }
        val end = content.indexOf(close, start)
        val after = if (end < 0) "" else content.substring(end + close.length)
        return (content.substring(0, start) + after).trimEnd()
    }
}
