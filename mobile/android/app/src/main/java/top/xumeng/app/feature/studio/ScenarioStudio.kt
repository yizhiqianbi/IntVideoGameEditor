package top.xumeng.app.feature.studio

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import top.xumeng.app.BuildConfig
import top.xumeng.app.core.network.ScenarioDraft
import top.xumeng.app.core.network.ScenarioRole
import top.xumeng.app.core.network.ScenarioRules
import top.xumeng.app.core.network.ScenarioStage
import top.xumeng.app.core.network.ScenarioSummary
import top.xumeng.app.core.network.XumengApi
import top.xumeng.app.shell.Ink
import top.xumeng.app.shell.Mark
import java.io.IOException
import java.util.UUID

data class ScenarioUi(
    val screen: Boolean = false,
    val guest: Boolean = true,
    val loaded: Boolean = false,
    val loading: Boolean = false,
    val saving: Boolean = false,
    val scenarios: List<ScenarioSummary> = emptyList(),
    val draft: ScenarioDraft? = null,
    val error: String? = null,
    val listError: String? = null,
    val notice: String? = null,
    val dirty: Boolean = false,
)

private data class ScenarioLoad(val id: String, val guest: Boolean, val scenarios: List<ScenarioSummary>)

class ScenarioViewModel : ViewModel() {
    private val backend = XumengApi.get(BuildConfig.WEB_ORIGIN)
    private val mutable = MutableStateFlow(ScenarioUi())
    val state: StateFlow<ScenarioUi> = mutable.asStateFlow()
    private var accountId: String? = null
    private var saved: ScenarioDraft? = null
    private var generation = 0
    private var action = 0

    fun showGuest() {
        accountId = null
        saved = null
        generation += 1
        action += 1
        mutable.update { ScenarioUi(screen = it.screen, guest = true, loaded = true) }
    }

    fun closeScreen() {
        saved = null
        mutable.update { it.copy(screen = false, draft = null, dirty = false, error = null, notice = null) }
    }

    fun closeDraft() {
        saved = null
        mutable.update { it.copy(draft = null, dirty = false, error = null, notice = null) }
    }

    fun refresh() {
        val ticket = ++generation
        mutable.update { it.copy(loading = it.draft == null, listError = null) }
        viewModelScope.launch {
            val loaded = runCatching {
                withContext(Dispatchers.IO) {
                    val session = backend.ensureSession()
                    if (session.user.guest) ScenarioLoad(session.user.id, true, emptyList())
                    else ScenarioLoad(session.user.id, false, backend.scenarioList(session.user.id))
                }
            }
            if (ticket != generation) return@launch
            loaded.fold(
                onSuccess = { result ->
                    if (result.guest) {
                        accountId = null
                        saved = null
                        mutable.update { ScenarioUi(screen = it.screen, guest = true, loaded = true) }
                        return@fold
                    }
                    val switched = accountId != null && accountId != result.id
                    accountId = result.id
                    if (switched) saved = null
                    mutable.update {
                        it.copy(
                            loading = false,
                            loaded = true,
                            guest = false,
                            scenarios = result.scenarios,
                            listError = null,
                            draft = if (switched) null else it.draft,
                            dirty = if (switched) false else it.dirty,
                            error = if (switched) null else it.error,
                            notice = if (switched) null else it.notice,
                        )
                    }
                },
                onFailure = { error ->
                    mutable.update { it.copy(loading = false, loaded = true, listError = ScenarioRules.transport(error)) }
                },
            )
        }
    }

    fun open(id: String) {
        if (mutable.value.saving) return
        val owner = accountId
        val ticket = ++action
        mutable.update { it.copy(screen = true, guest = false, saving = true, error = null, notice = null) }
        viewModelScope.launch {
            val loaded = runCatching {
                withContext(Dispatchers.IO) {
                    val session = backend.ensureSession()
                    if (session.user.guest) throw IOException("请登录后创作或参加团本。")
                    if (owner != null && owner != session.user.id) throw IOException("账号已切换，请重新打开当前账号的团本。")
                    session.user.id to backend.scenario(session.user.id, id)
                }
            }
            if (ticket != action) return@launch
            loaded.fold(
                onSuccess = { (id, draft) ->
                    if (accountId != null && accountId != id) {
                        mutable.update { it.copy(saving = false, error = "账号已切换，请重新打开当前账号的团本。") }
                        return@fold
                    }
                    accountId = id
                    saved = draft
                    mutable.update { it.copy(saving = false, guest = false, loaded = true, draft = draft, dirty = false) }
                },
                onFailure = { error ->
                    mutable.update { it.copy(saving = false, loaded = true, error = ScenarioRules.transport(error)) }
                },
            )
        }
    }

    fun createTemplate() = showNew(ScenarioRules.create(true))

    fun createBlank() = showNew(ScenarioRules.create(false))

    fun edit(block: (ScenarioDraft) -> ScenarioDraft) {
        if (mutable.value.saving) return
        val current = mutable.value.draft ?: return
        val next = block(current)
        val baseline = saved
        val dirty = baseline == null || next.version == null || !ScenarioRules.sameContent(baseline, next)
        mutable.update { it.copy(draft = next, dirty = dirty, notice = null, error = null) }
    }

    fun save() {
        val draft = mutable.value.draft ?: return
        if (mutable.value.saving || mutable.value.guest || !mutable.value.dirty) return
        val owner = accountId
        val ticket = ++action
        mutable.update { it.copy(saving = true, error = null, notice = null) }
        viewModelScope.launch {
            val savedDraft = runCatching {
                withContext(Dispatchers.IO) {
                    val session = backend.ensureSession()
                    if (session.user.guest) throw IOException("请登录后创作或参加团本。")
                    if (owner != null && session.user.id != owner) throw IOException("账号已切换，请重新打开当前账号的团本。")
                    session.user.id to backend.saveScenario(session.user.id, draft)
                }
            }
            if (ticket != action) return@launch
            savedDraft.fold(
                onSuccess = { (id, next) ->
                    if (accountId != null && accountId != id) {
                        mutable.update { it.copy(saving = false, error = "账号已切换，请重新打开当前账号的团本。") }
                        return@fold
                    }
                    accountId = id
                    saved = next
                    val summary = ScenarioRules.summary(next)
                    mutable.update { state ->
                        state.copy(
                            saving = false,
                            guest = false,
                            loaded = true,
                            draft = next,
                            dirty = false,
                            notice = "私人团本已保存。",
                            scenarios = listOf(summary) + state.scenarios.filter { it.id != next.id },
                        )
                    }
                },
                onFailure = { error ->
                    mutable.update { it.copy(saving = false, error = ScenarioRules.transport(error)) }
                },
            )
        }
    }

    private fun showNew(draft: ScenarioDraft) {
        if (mutable.value.saving) return
        saved = null
        mutable.update { it.copy(screen = true, guest = false, draft = draft, dirty = true, error = null, notice = null) }
    }
}

private val scenarioDay = java.time.format.DateTimeFormatter.ofPattern("yyyy/M/d", java.util.Locale.CHINA)
    .withZone(java.time.ZoneId.of("Asia/Shanghai"))

@Composable
fun ScenarioStudioScreen(state: ScenarioUi, model: ScenarioViewModel, onAccount: () -> Unit) {
    val draft = state.draft
    val busy = state.saving || state.loading
    var discard by remember { mutableStateOf<(() -> Unit)?>(null) }
    fun leave(action: () -> Unit) {
        if (draft != null && state.dirty) discard = action else action()
    }
    Box(Modifier.fillMaxSize().background(Ink.background)) {
        Column(Modifier.fillMaxSize().imePadding()) {
            Row(Modifier.fillMaxWidth().padding(start = 4.dp, end = 16.dp, top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                val backLabel = if (draft != null) "返回团本列表" else "返回创作中心"
                Box(
                    Modifier.size(44.dp).semantics { contentDescription = backLabel }.clickable(enabled = !busy) {
                        if (draft != null) leave(model::closeDraft) else model.closeScreen()
                    },
                    contentAlignment = Alignment.Center,
                ) { Mark("back", color = if (busy) Ink.line else Ink.text) }
                Column(Modifier.weight(1f)) {
                    Text("创作中心 / 团本", color = Ink.muted, fontSize = 12.sp)
                    Text(
                        if (draft != null) "编辑团本" else "团本",
                        color = Ink.text,
                        fontSize = 22.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            Text(
                when {
                    draft != null && busy -> "正在保存或加载…"
                    draft != null && state.dirty -> "尚未保存"
                    draft == null && (state.loading || state.saving) -> "正在读取团本…"
                    else -> "创作剧本、邀请同伴，在同一段故事里行动。"
                },
                color = Ink.muted,
                fontSize = 13.sp,
                modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 4.dp),
            )
            if (!state.guest) {
                Row(Modifier.padding(start = 16.dp, top = 10.dp, bottom = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (draft == null) {
                        ActionChip("空白团本", "plus", !busy, primary = false, model::createBlank)
                        ActionChip("使用冒险模板", "plus", !busy, primary = true, model::createTemplate)
                    } else {
                        val label = when {
                            state.saving -> "保存中…"
                            state.dirty -> "保存草稿"
                            else -> "已保存"
                        }
                        ActionChip(label, "check", !busy && state.dirty, primary = true, model::save)
                    }
                }
            }
            val alert = state.error ?: if (draft == null) state.listError else null
            state.notice?.let { Text(it, color = Ink.accent, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) }
            alert?.let { Text(it, color = Color(0xFFFF8AA3), fontSize = 13.sp, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) }
            when {
                state.guest -> GuestGate(onAccount, Modifier.weight(1f))
                draft == null -> ScenarioLibrary(state, model, Modifier.weight(1f))
                else -> ScenarioEditor(state, model, Modifier.weight(1f))
            }
        }
        discard?.let { action ->
            Box(Modifier.fillMaxSize().background(Color(0xAA000000)).clickable { discard = null })
            Column(
                Modifier.align(Alignment.Center).padding(28.dp).clip(RoundedCornerShape(12.dp)).background(Ink.surface).clickable {}.padding(20.dp),
            ) {
                Text("当前团本尚未保存。继续会丢掉编辑器里的修改。", color = Ink.text, fontSize = 16.sp)
                Row(Modifier.padding(top = 16.dp), horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                    Text("留下", color = Ink.muted, modifier = Modifier.clickable { discard = null }.padding(vertical = 8.dp))
                    Text("继续", color = Ink.accent, modifier = Modifier.clickable {
                        discard = null
                        action()
                    }.padding(vertical = 8.dp))
                }
            }
        }
    }
}

@Composable
private fun GuestGate(onAccount: () -> Unit, modifier: Modifier) {
    Column(modifier.fillMaxWidth().padding(16.dp)) {
        Text("登录后保存私人团本", color = Ink.text, fontSize = 18.sp)
        Text("剧本和主持笔记由你管理，房间仅对受邀参与者开放。", color = Ink.muted, fontSize = 14.sp, modifier = Modifier.padding(top = 8.dp))
        Text("登录 / 注册", color = Ink.accent, fontSize = 15.sp, modifier = Modifier.clickable(onClick = onAccount).padding(top = 12.dp))
    }
}

@Composable
private fun ScenarioLibrary(state: ScenarioUi, model: ScenarioViewModel, modifier: Modifier) {
    var search by remember { mutableStateOf("") }
    val needle = search.trim()
    val results = state.scenarios.filter { item ->
        needle.isEmpty() || "${item.title} ${item.synopsis}".lowercase().contains(needle.lowercase())
    }
    val busy = state.saving || state.loading
    LazyColumn(modifier.fillMaxWidth(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 28.dp)) {
        item {
            Row(Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("我的剧本 ${state.scenarios.size}", color = Ink.text, fontSize = 16.sp, modifier = Modifier.weight(1f))
                Row(Modifier.clickable(enabled = !busy) { model.refresh() }, verticalAlignment = Alignment.CenterVertically) {
                    Mark("refresh", size = 15.dp, color = Ink.muted)
                    Text("刷新列表", color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(start = 6.dp))
                }
            }
            TextField(
                value = search,
                onValueChange = { search = it },
                modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp).semantics { contentDescription = "搜索团本" },
                singleLine = true,
                placeholder = { Text("标题或简介") },
                leadingIcon = { Mark("search", color = Ink.muted) },
                colors = fieldColors(),
            )
        }
        when {
            state.loading -> item { Text("正在读取团本…", color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(vertical = 12.dp)) }
            results.isNotEmpty() -> items(results, key = { it.id }) { item ->
                Row(
                    Modifier.fillMaxWidth().clickable(enabled = !state.saving) { model.open(item.id) }.padding(vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(40.dp).background(Ink.line, RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
                        Mark("users", color = Ink.muted)
                    }
                    Column(Modifier.padding(start = 12.dp).weight(1f)) {
                        Text(item.title.ifBlank { "未命名团本" }, color = Ink.text, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(item.synopsis.ifBlank { "尚未填写简介" }, color = Ink.muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 4.dp))
                        Text(
                            "${item.roleCount} 个角色位 · ${item.stageCount} 个阶段 · ${scenarioDay.format(java.time.Instant.ofEpochMilli(item.updatedAt))}",
                            color = Ink.muted,
                            fontSize = 11.sp,
                            modifier = Modifier.padding(top = 4.dp),
                        )
                    }
                    Text("继续创作", color = Ink.accent, fontSize = 12.sp)
                    Mark("chevron", size = 14.dp, color = Ink.accent)
                }
            }
            else -> item {
                val message = when {
                    needle.isNotEmpty() -> "没有找到对应团本。"
                    state.listError != null -> "团本未能加载，可刷新重试。"
                    else -> "还没有私人团本。使用冒险模板开始，或新建空白团本。"
                }
                Text(message, color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(vertical = 12.dp))
            }
        }
    }
}

@Composable
private fun ScenarioEditor(state: ScenarioUi, model: ScenarioViewModel, modifier: Modifier) {
    val draft = state.draft ?: return
    val warnings = remember(draft) { ScenarioRules.readiness(draft) }
    val busy = state.saving
    Column(modifier.verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
        Area("标题") {
            TextField(
                value = draft.title,
                onValueChange = { value -> model.edit { it.copy(title = value.take(120)) } },
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = "团本标题" },
                singleLine = true,
                enabled = !busy,
                placeholder = { Text("为这次冒险起个名字") },
                colors = fieldColors(),
            )
        }
        Area("公开简介") {
            Lines(draft.synopsis, "邀请预览显示的玩法与基调", 3, !busy) { value -> model.edit { it.copy(synopsis = value.take(2000)) } }
        }
        Area("世界设定") {
            Lines(draft.world, null, 5, !busy) { value -> model.edit { it.copy(world = value.take(20000)) } }
        }
        Area("任务目标") {
            Lines(draft.goal, null, 3, !busy) { value -> model.edit { it.copy(goal = value.take(4000)) } }
        }
        Area("开场", "开始团本时发布；给玩家留下可接续的行动。") {
            Lines(draft.opening, null, 6, !busy) { value -> model.edit { it.copy(opening = value.take(12000)) } }
        }
        Row(Modifier.fillMaxWidth().padding(top = 18.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("角色位", color = Ink.text, fontSize = 16.sp)
                Text("设置 2–8 个玩家角色，每个角色位由一位参与者占用。", color = Ink.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
            }
            Text(
                "＋ 角色位",
                color = if (draft.roles.size >= 8 || busy) Ink.line else Ink.accent,
                fontSize = 14.sp,
                modifier = Modifier.clickable(enabled = draft.roles.size < 8 && !busy) {
                    model.edit { current ->
                        if (current.roles.size >= 8) current
                        else current.copy(roles = current.roles + ScenarioRole(UUID.randomUUID().toString(), "", "", ""))
                    }
                }.padding(start = 8.dp),
            )
        }
        draft.roles.forEachIndexed { index, role ->
            Column(Modifier.fillMaxWidth().padding(top = 8.dp).background(Ink.surface, RoundedCornerShape(12.dp)).padding(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("角色 ${index + 1}", color = Ink.text, fontSize = 14.sp, modifier = Modifier.weight(1f))
                    Text(
                        "移除",
                        color = if (busy) Ink.line else Ink.accent,
                        fontSize = 13.sp,
                        modifier = Modifier.clickable(enabled = !busy) {
                            model.edit { current -> current.copy(roles = current.roles.filter { it.id != role.id }) }
                        },
                    )
                }
                Area("角色名") {
                    TextField(
                        value = role.name,
                        onValueChange = { value -> model.edit { current -> current.copy(roles = current.roles.map { if (it.id == role.id) it.copy(name = value.take(80)) else it }) } },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        enabled = !busy,
                        colors = fieldColors(),
                    )
                }
                Area("公开描述") {
                    Lines(role.description, null, 3, !busy) { value ->
                        model.edit { current -> current.copy(roles = current.roles.map { if (it.id == role.id) it.copy(description = value.take(4000)) else it }) }
                    }
                }
                Area("性格与秘密 · 仅主持可见") {
                    Lines(role.personality, null, 3, !busy) { value ->
                        model.edit { current -> current.copy(roles = current.roles.map { if (it.id == role.id) it.copy(personality = value.take(4000)) else it }) }
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(top = 18.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("阶段与地点", color = Ink.text, fontSize = 16.sp, modifier = Modifier.weight(1f))
            Text(
                "＋ 阶段",
                color = if (draft.stages.size >= 20 || busy) Ink.line else Ink.accent,
                fontSize = 14.sp,
                modifier = Modifier.clickable(enabled = draft.stages.size < 20 && !busy) {
                    model.edit { current ->
                        if (current.stages.size >= 20) current
                        else current.copy(stages = current.stages + ScenarioStage(UUID.randomUUID().toString(), "", "", ""))
                    }
                },
            )
        }
        draft.stages.forEachIndexed { index, stage ->
            Column(Modifier.fillMaxWidth().padding(top = 8.dp).background(Ink.surface, RoundedCornerShape(12.dp)).padding(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("第 ${index + 1} 阶段", color = Ink.text, fontSize = 14.sp, modifier = Modifier.weight(1f))
                    Text(
                        "上移",
                        color = if (index == 0 || busy) Ink.line else Ink.muted,
                        fontSize = 13.sp,
                        modifier = Modifier.semantics { contentDescription = "上移阶段 ${index + 1}" }.clickable(enabled = index > 0 && !busy) {
                            model.edit { current ->
                                val from = current.stages.indexOfFirst { it.id == stage.id }
                                if (from <= 0) current
                                else {
                                    val next = current.stages.toMutableList()
                                    val item = next.removeAt(from)
                                    next.add(from - 1, item)
                                    current.copy(stages = next)
                                }
                            }
                        }.padding(end = 12.dp),
                    )
                    Text(
                        "移除",
                        color = if (busy) Ink.line else Ink.accent,
                        fontSize = 13.sp,
                        modifier = Modifier.clickable(enabled = !busy) {
                            model.edit { current -> current.copy(stages = current.stages.filter { it.id != stage.id }) }
                        },
                    )
                }
                Area("阶段名") {
                    TextField(
                        value = stage.title,
                        onValueChange = { value -> model.edit { current -> current.copy(stages = current.stages.map { if (it.id == stage.id) it.copy(title = value.take(120)) else it }) } },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        enabled = !busy,
                        colors = fieldColors(),
                    )
                }
                Area("地点") {
                    Lines(stage.location, null, 1, !busy) { value ->
                        model.edit { current -> current.copy(stages = current.stages.map { if (it.id == stage.id) it.copy(location = value.take(240)) else it }) }
                    }
                }
                Area("目标与转场条件") {
                    Lines(stage.objective, null, 3, !busy) { value ->
                        model.edit { current -> current.copy(stages = current.stages.map { if (it.id == stage.id) it.copy(objective = value.take(4000)) else it }) }
                    }
                }
            }
        }
        Text("主持资料", color = Ink.text, fontSize = 16.sp, modifier = Modifier.padding(top = 18.dp))
        Area("AI 主持提示词") {
            Lines(draft.dmPrompt, null, 4, !busy) { value -> model.edit { it.copy(dmPrompt = value.take(12000)) } }
        }
        Area("隐藏笔记", "谜底、未揭露线索与分支计划不会返回给玩家。") {
            Lines(draft.hostNotes, null, 4, !busy) { value -> model.edit { it.copy(hostNotes = value.take(20000)) } }
        }
        if (warnings.isNotEmpty()) {
            Text("开房检查", color = Ink.text, fontSize = 16.sp, modifier = Modifier.padding(top = 18.dp))
            warnings.forEach { warning ->
                Text(warning, color = Ink.muted, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
            }
        }
        Text("保存草稿不要求开房条件。标题 120 字，简介 2000 字，角色位最多 8 个，阶段最多 20 个。", color = Ink.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 14.dp, bottom = 24.dp))
    }
}

@Composable
private fun Area(label: String, hint: String? = null, content: @Composable () -> Unit) {
    Text(label, color = Ink.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 10.dp, bottom = 4.dp))
    content()
    if (hint != null) Text(hint, color = Ink.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
}

@Composable
private fun Lines(value: String, placeholder: String?, minLines: Int, enabled: Boolean, onValue: (String) -> Unit) {
    TextField(
        value = value,
        onValueChange = onValue,
        modifier = Modifier.fillMaxWidth(),
        minLines = minLines,
        maxLines = minLines + 4,
        enabled = enabled,
        placeholder = if (placeholder == null) null else ({ Text(placeholder) }),
        colors = fieldColors(),
    )
}

@Composable
private fun ActionChip(label: String, icon: String, enabled: Boolean, primary: Boolean, onClick: () -> Unit) {
    val background = when {
        !enabled -> Ink.line
        primary -> Ink.accent
        else -> Ink.surface
    }
    val content = if (primary || !enabled) Color.White else Ink.text
    val shape = RoundedCornerShape(8.dp)
    Row(
        Modifier.clip(shape).background(background).then(if (primary || !enabled) Modifier else Modifier.border(1.dp, Ink.line, shape)).clickable(enabled = enabled, onClick = onClick).padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Mark(icon, size = 16.dp, color = content)
        Text(label, color = content, fontSize = 14.sp, modifier = Modifier.padding(start = 6.dp))
    }
}

@Composable
private fun fieldColors() = TextFieldDefaults.colors(
    focusedContainerColor = Ink.surface,
    unfocusedContainerColor = Ink.surface,
    disabledContainerColor = Ink.surface,
    focusedTextColor = Ink.text,
    unfocusedTextColor = Ink.text,
    disabledTextColor = Ink.text,
    focusedIndicatorColor = Color.Transparent,
    unfocusedIndicatorColor = Color.Transparent,
    disabledIndicatorColor = Color.Transparent,
    cursorColor = Ink.accent,
    focusedPlaceholderColor = Ink.muted,
    unfocusedPlaceholderColor = Ink.muted,
)
