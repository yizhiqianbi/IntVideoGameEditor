package top.xumeng.app.feature.profile

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import top.xumeng.app.BuildConfig
import top.xumeng.app.core.network.AccountUser
import top.xumeng.app.core.network.CatalogBrief
import top.xumeng.app.core.network.FollowedAuthor
import top.xumeng.app.core.network.XumengApi
import top.xumeng.app.shell.Ink

data class ProfileTalk(val id: String, val title: String, val preview: String, val updatedAt: Long = 0)

data class ProfileUi(
    val loading: Boolean = true,
    val user: AccountUser? = null,
    val cards: List<CatalogBrief> = emptyList(),
    val saved: List<CatalogBrief> = emptyList(),
    val talks: List<ProfileTalk> = emptyList(),
    val following: List<FollowedAuthor> = emptyList(),
    val version: Int = 0,
    val bio: String = "",
    val error: String? = null,
    val busy: Boolean = false,
)

class ProfileViewModel : ViewModel() {
    private val backend = XumengApi.get(BuildConfig.WEB_ORIGIN)
    private val mutable = MutableStateFlow(ProfileUi())
    val state: StateFlow<ProfileUi> = mutable.asStateFlow()

    init { refresh() }

    fun refresh() {
        viewModelScope.launch {
            mutable.update { it.copy(loading = true, error = null) }
            val loaded = runCatching { withContext(Dispatchers.IO) { loadMine() } }
            loaded.fold(
                onSuccess = { mine -> mutable.update { it.copy(loading = false, user = mine.user, cards = mine.cards, saved = mine.saved, talks = mine.talks, following = mine.following, version = mine.version, bio = mine.bio) } },
                onFailure = { error -> mutable.update { it.copy(loading = false, error = error.message) } },
            )
        }
    }

    fun login(email: String, password: String) = auth { backend.login(email.trim(), password) }

    fun register(email: String, password: String, nickname: String) = auth { backend.register(email.trim(), password, nickname.trim()) }

    fun logout() = auth { backend.logoutToGuest() }

    fun deleteCard(id: String) {
        val current = mutable.value
        val user = current.user ?: return
        if (id.isBlank() || current.busy) return
        viewModelScope.launch {
            mutable.update { it.copy(busy = true, error = null) }
            val done = runCatching { withContext(Dispatchers.IO) { backend.deleteCard(id, current.version, user.id); loadMine() } }
            done.fold(
                onSuccess = { mine -> mutable.update { it.copy(busy = false, user = mine.user, cards = mine.cards, saved = mine.saved, talks = mine.talks, following = mine.following, version = mine.version, bio = mine.bio) } },
                onFailure = { error -> mutable.update { it.copy(busy = false, error = error.message ?: "角色没有删除") } },
            )
        }
    }

    private fun loadMine(): ProfileUi {
        val record = backend.ensureSession()
        val desk = runCatching { backend.authorDesk() }.getOrNull()
        val cards = desk?.cards?.map { CatalogBrief(it.id, it.name.ifBlank { "未命名" }) } ?: emptyList()
        val saved = runCatching { backend.catalogBriefs(backend.favoriteIds()) }.getOrDefault(emptyList())
        val talks = record.talks.map { talk ->
            ProfileTalk(talk.id, talk.title.ifBlank { "对话" }, talk.lines.lastOrNull()?.text.orEmpty().lineSequence().firstOrNull()?.take(80).orEmpty(), talk.updatedAt)
        }.sortedByDescending { it.updatedAt }
        val following = runCatching { backend.followedShelf() }.getOrDefault(emptyList())
        return ProfileUi(loading = false, user = record.user, cards = cards, saved = saved, talks = talks, following = following, version = desk?.version ?: record.version, bio = desk?.bio.orEmpty())
    }

    private fun auth(block: () -> top.xumeng.app.core.network.AccountRecord) {
        viewModelScope.launch {
            mutable.update { it.copy(busy = true, error = null) }
            val result = runCatching { withContext(Dispatchers.IO) { block(); loadMine() } }
            result.fold(
                onSuccess = { mine -> mutable.update { it.copy(busy = false, user = mine.user, cards = mine.cards, saved = mine.saved, talks = mine.talks, following = mine.following, version = mine.version, bio = mine.bio) } },
                onFailure = { error -> mutable.update { it.copy(busy = false, error = error.message ?: "账号操作失败") } },
            )
        }
    }
}

@Composable
fun ProfileScreen(
    onAuthor: (String, String) -> Unit = { _, _ -> },
    onRole: (String, String) -> Unit = { _, _ -> },
    onEdit: (String) -> Unit = {},
    onSaved: (String) -> Unit = {},
    onTalk: (String) -> Unit = {},
    onMenu: (String) -> Unit = {},
) {
    val model = viewModel<ProfileViewModel>()
    val state by model.state.collectAsState()
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var nickname by remember { mutableStateOf("") }
    var tab by remember { mutableStateOf("recent") }
    var pendingDelete by remember { mutableStateOf<String?>(null) }
    var copied by remember { mutableStateOf(false) }
    val clipboard = LocalClipboardManager.current
    val user = state.user
    Box(Modifier.fillMaxSize().background(Ink.background)) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp)) {
        Text("我的", color = Ink.text, fontSize = 22.sp)
        Spacer(Modifier.height(18.dp))
        when {
            state.loading -> Text("正在读取账号", color = Ink.muted)
            user == null -> Text(state.error ?: "还没有账号", color = Ink.muted)
            else -> {
                Text(user.nickname, color = Ink.text, fontSize = 20.sp)
                if (state.bio.isNotBlank()) Text(state.bio, color = Ink.text, fontSize = 14.sp, modifier = Modifier.padding(top = 6.dp))
                Text(if (user.guest) "游客 · 和网站同一个账号服务" else user.email ?: "已登录", color = Ink.muted, fontSize = 14.sp, modifier = Modifier.padding(top = 6.dp))
                Text(if (copied) "已复制编号" else "复制编号", color = Ink.accent, fontSize = 13.sp, modifier = Modifier.clickable {
                    clipboard.setText(AnnotatedString(user.id))
                    copied = true
                }.padding(top = 8.dp))
                Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    listOf("create" to "创作", "settings" to "设置", "presets" to "预设", "wallet" to "Credit", "invite" to "邀请").forEach { (id, label) ->
                        Text(label, color = Ink.text, fontSize = 14.sp, modifier = Modifier.clickable { onMenu(id) }.padding(vertical = 6.dp))
                    }
                }
                Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    listOf("recent" to "最近", "characters" to "角色 ${state.cards.size}", "saved" to "收藏 ${state.saved.size}", "talks" to "对话 ${state.talks.size}", "following" to "关注 ${state.following.size}").forEach { (id, label) ->
                        Text(label, color = if (tab == id) Ink.accent else Ink.muted, fontSize = 14.sp, modifier = Modifier.clickable { tab = id }.padding(vertical = 6.dp))
                    }
                }
                when (tab) {
                    "characters" -> {
                        if (state.cards.isEmpty()) Text("还没有角色", color = Ink.muted, fontSize = 14.sp, modifier = Modifier.padding(top = 8.dp))
                        else state.cards.forEach { card ->
                            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                                Text(card.name, color = Ink.text, fontSize = 15.sp, modifier = Modifier.weight(1f).clickable { onRole(card.id, card.name) })
                                Text("编辑", color = Ink.accent, fontSize = 13.sp, modifier = Modifier.clickable { onEdit(card.id) }.padding(end = 12.dp))
                                Text(
                                    "删除",
                                    color = Color(0xFFFF8AA3),
                                    fontSize = 13.sp,
                                    modifier = Modifier.clickable(enabled = !state.busy) { pendingDelete = card.id },
                                )
                            }
                        }
                    }
                    "saved" -> Names(state.saved.map { it.id to it.name }, "还没有收藏") { onSaved(it) }
                    "talks" -> Names(state.talks.map { it.id to it.title.ifBlank { it.preview.ifBlank { "对话" } } }, "还没有对话") { onTalk(it) }
                    "following" -> Names(state.following.map { it.id to it.name }, "还没有关注的作者") { id -> onAuthor(id, state.following.find { it.id == id }?.name ?: "关注的作者") }
                    else -> Names(state.talks.map { talk -> talk.id to listOf(talk.title, talk.preview).filter { it.isNotBlank() }.joinToString(" · ") }, "还没有动态") { onTalk(it) }
                }
            }
        }
        state.error?.let { Text(it, color = Color(0xFFFF8AA3), fontSize = 13.sp, modifier = Modifier.padding(top = 12.dp)) }
        Spacer(Modifier.height(22.dp))
        Field("邮箱", email) { email = it }
        Field("密码", password, password = true) { password = it }
        Field("昵称，注册时填写", nickname) { nickname = it }
        Spacer(Modifier.height(8.dp))
        Action("登录") { model.login(email, password) }
        Action("注册") { model.register(email, password, nickname) }
        if (user != null && !user.guest) Action("退出并换一个游客") { model.logout() }
    }
    val deleting = state.cards.find { it.id == pendingDelete }
    if (deleting != null) {
        Box(Modifier.fillMaxSize().background(Color(0xAA000000)).clickable { pendingDelete = null })
        Column(Modifier.align(Alignment.Center).padding(28.dp).background(Ink.surface, RoundedCornerShape(12.dp)).padding(20.dp)) {
            Text("删除角色", color = Ink.text, fontSize = 18.sp)
            Text("删除「${deleting.name}」及它的收藏和关联会话？此操作无法撤销。", color = Ink.muted, fontSize = 14.sp, modifier = Modifier.padding(top = 10.dp))
            Row(Modifier.padding(top = 16.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Text("取消", color = Ink.muted, modifier = Modifier.clickable { pendingDelete = null }.padding(vertical = 8.dp))
                Text("删除角色", color = Color(0xFFFF8AA3), modifier = Modifier.clickable(enabled = !state.busy) {
                    val id = deleting.id
                    pendingDelete = null
                    model.deleteCard(id)
                }.padding(vertical = 8.dp))
            }
        }
    }
    }
}

@Composable
private fun Names(rows: List<Pair<String, String>>, empty: String, open: (String) -> Unit) {
    if (rows.isEmpty()) Text(empty, color = Ink.muted, fontSize = 14.sp, modifier = Modifier.padding(top = 8.dp))
    else rows.forEach { (id, name) ->
        Text(name, color = Ink.text, fontSize = 15.sp, modifier = Modifier.clickable { open(id) }.padding(vertical = 8.dp))
    }
}

@Composable
private fun Field(label: String, value: String, password: Boolean = false, onChange: (String) -> Unit) {
    Text(label, color = Ink.muted, fontSize = 12.sp, modifier = Modifier.padding(bottom = 6.dp))
    TextField(
        value = value,
        onValueChange = onChange,
        modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp),
        singleLine = true,
        visualTransformation = if (password) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = if (password) KeyboardType.Password else KeyboardType.Email),
        colors = TextFieldDefaults.colors(
            focusedContainerColor = Ink.surface,
            unfocusedContainerColor = Ink.surface,
            focusedTextColor = Ink.text,
            unfocusedTextColor = Ink.text,
            focusedIndicatorColor = Color.Transparent,
            unfocusedIndicatorColor = Color.Transparent,
            cursorColor = Ink.accent,
        ),
    )
}

@Composable
private fun Action(label: String, onClick: () -> Unit) {
    Text(label, color = Ink.text, fontSize = 15.sp, modifier = Modifier.clickable(onClick = onClick).padding(vertical = 10.dp))
}
