package top.xumeng.app.feature.chat

import org.json.JSONArray
import org.json.JSONObject
import top.xumeng.app.core.network.Line

/** Append one server-accepted world snapshot, using the same same-prefix rule as the website. */
object WorldJournal {
    fun append(existing: String, messages: List<Line>, event: JSONObject, clock: String): JSONObject? {
        val state = event.optJSONObject("state") ?: return null
        if (!event.has("recordedAt")) return null
        val mode = if (clock == "realtime") "realtime" else "story"
        val journal = runCatching { JSONObject(existing) }.getOrElse { JSONObject() }
        val snapshots = journal.optJSONArray("snapshots") ?: JSONArray()
        val last = snapshots.optJSONObject(snapshots.length() - 1)
        if (last != null && last.optInt("sourceCount") == messages.size && last.optString("clockMode") == mode) return journal
        if (last != null && last.optInt("sourceCount") == messages.size) snapshots.remove(snapshots.length() - 1)
        snapshots.put(JSONObject()
            .put("sourceCount", messages.size)
            .put("sourceFingerprint", StoryFingerprint.of(messages))
            .put("recordedAt", event.optLong("recordedAt"))
            .put("clockMode", mode)
            .put("state", state))
        while (snapshots.length() > 8) snapshots.remove(0)
        journal.put("version", 1)
        journal.put("snapshots", snapshots)
        return journal
    }

    /** Record a story/realtime switch and pin the current facts to this message prefix. */
    fun switchMode(existing: String, messages: List<Line>, mode: String, now: Long): JSONObject {
        val clock = if (mode == "realtime") "realtime" else "story"
        val journal = runCatching { JSONObject(existing) }.getOrElse { JSONObject() }
        journal.put("version", 1)
        val kept = JSONArray()
        val current = journal.optJSONArray("snapshots")
        if (current != null && messages.isNotEmpty()) {
            for (index in 0 until current.length()) {
                val snapshot = current.optJSONObject(index) ?: continue
                if (snapshot.optInt("sourceCount") < messages.size) kept.put(snapshot)
            }
        }
        journal.put("snapshots", kept)
        val changes = journal.optJSONArray("modeChanges") ?: JSONArray()
        val last = changes.optJSONObject(changes.length() - 1)
        if (last == null || last.optString("clockMode") != clock) {
            var at = now
            val previousAt = last?.optLong("recordedAt") ?: -1
            if (at <= previousAt) at = previousAt + 1
            changes.put(JSONObject().put("recordedAt", at).put("clockMode", clock))
        }
        while (changes.length() > 128) changes.remove(0)
        journal.put("modeChanges", changes)
        if (messages.isEmpty()) return journal
        val state = kept.optJSONObject(kept.length() - 1)?.optJSONObject("state") ?: blankState()
        val event = JSONObject().put("state", state).put("recordedAt", now)
        return append(journal.toString(), messages, event, clock) ?: journal
    }

    /** Copy checkpoints onto a duplicated transcript so the new message ids still match. */
    fun rebind(existing: String, original: List<Line>, copied: List<Line>): JSONObject? {
        if (existing.isBlank() || copied.size != original.size) return null
        if (original.indices.any { original[it].role != copied[it].role || original[it].text != copied[it].text }) return null
        val journal = runCatching { JSONObject(existing) }.getOrNull() ?: return null
        if (journal.optInt("version") != 1) return null
        val snapshots = journal.optJSONArray("snapshots") ?: JSONArray()
        val kept = JSONArray()
        for (index in 0 until snapshots.length()) {
            val snapshot = snapshots.optJSONObject(index) ?: continue
            val count = snapshot.optInt("sourceCount")
            if (count !in 1..copied.size) continue
            if (snapshot.optString("sourceFingerprint") != StoryFingerprint.of(original.take(count))) continue
            val next = JSONObject(snapshot.toString())
            next.put("sourceFingerprint", StoryFingerprint.of(copied.take(count)))
            kept.put(next)
        }
        val changes = journal.optJSONArray("modeChanges")
        if (kept.length() == 0 && (changes == null || changes.length() == 0)) return null
        val rebound = JSONObject().put("version", 1).put("snapshots", kept)
        if (changes != null && changes.length() > 0) {
            val earliest = (0 until kept.length()).mapNotNull { kept.optJSONObject(it)?.takeIf { item -> item.has("recordedAt") }?.optLong("recordedAt") }.minOrNull()
            val keptChanges = JSONArray()
            for (index in 0 until changes.length()) {
                val change = changes.optJSONObject(index) ?: continue
                if (earliest == null || change.optLong("recordedAt") >= earliest) keptChanges.put(change)
            }
            if (keptChanges.length() > 0) rebound.put("modeChanges", keptChanges)
        }
        return rebound
    }

    private fun blankState(): JSONObject = JSONObject()
        .put("clock", JSONObject().put("elapsedMinutes", 0).put("day", 1).put("minuteOfDay", JSONObject.NULL).put("calendarLabel", "").put("remainderMs", 0))
        .put("location", "")
        .put("relationships", JSONArray())
        .put("threads", JSONArray())
        .put("facts", JSONArray())
}
