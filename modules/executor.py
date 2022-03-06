# -*- encoding: utf-8 -*-


__all__ = [
    "ExecutorConfig",
    "ExecutorAbstract",
    "Executor",
    "support_langs"
]


import cchardet as chardet

from abc import ABC, abstractmethod
from typing import Any, Tuple, List, AnyStr
from . import (e, t, log, sys, json, asyncio, warnings,
               Path, field, dataclass, InitVar, FeatureCfg,
               ModelCfgType, CfgSectionType)


support_langs = (
    "python",
    "php",
    "nodejs",
    "shell",
    "wincmd",
    "powershell",
    "git-bash",
    "wsl-bash",
    # 无关联特定语言，命令行模式
    "generic",
    # 别名
    "git",          # alias 'git-bash'
    "wsl-bash",     # alias 'wsl-bash'
    "bash"          # alias 'shell'
)


temp_dir = Path(__file__).parent.parent.joinpath("temp")


# windows 10 subsystem support bash shell if one is installed
TAG_OF_LANGUAGE = dict(
    python="python",
    php="php",
    nodejs="node",
    shell="bash",
    wincmd="cmd",
    powershell="powershell",
    git_bash="git",
    wsl_bash="wsl")


# <None> stands for no support for specified language
CODE_STRING_EVAL_OPT = dict(
    python="-c",
    php="-r",
    nodejs="-p",
    shell="-c",
    wincmd="/C",
    powershell="-Command",
    git_bash="-c",
    wsl_bash="-c")


# <None> stands for no support for specified language
CODE_FILE_EVAL_OPT = dict(
    python="",
    php="-f",
    nodejs="",
    shell="",
    wincmd=None,
    powershell="-File",
    git_bash="",
    wsl_bash="")


def decode(content: bytes):
    detected = chardet.detect(content)
    encoding = detected["encoding"]
    if encoding is None:
        raise e.FeatureError("命令已执行，但内容编码识别失败")
    return content.decode(encoding=encoding)


def determine_real_target(lang_tag, guessed_out):
    first_target = guessed_out.strip().split()[0]
    if lang_tag in (TAG_OF_LANGUAGE["git_bash"], TAG_OF_LANGUAGE["wsl_bash"]):
        return str(Path(first_target).parent.joinpath("bash.exe"))
    return first_target


async def guess_from_path_on_windows(tag_of_lang):
    cmd = f"WHERE {tag_of_lang}"
    params = dict(
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE)
    proc = await asyncio.subprocess.create_subprocess_shell(cmd, **params)
    stdout, stderr = await proc.communicate()
    exit_status = proc.returncode
    message = f"未搜索到“{tag_of_lang}”二进制执行文件"
    if exit_status != 0 or stderr:
        reason = f": {decode(stderr)}" if stderr else ""
        raise e.FeatureError(message + reason)
    if stdout:
        first_target = determine_real_target(tag_of_lang, decode(stdout))
        if first_target:
            return first_target
    raise e.FeatureError(message)


async def guess_from_path(lang) -> str:
    if lang == "python":
        return sys.executable
    lang = lang.replace("-", "_")       # 兼容带连字符的语言名称，如 git-bash
    tag_of_lang = TAG_OF_LANGUAGE[lang]
    guessed = await guess_from_path_on_windows(tag_of_lang)
    return guessed


def determine_code_string_eval_opt(lang):
    opt = CODE_STRING_EVAL_OPT.get(lang, None)
    if opt is None:
        raise e.FeatureError(f"{lang}：当前实现不支持求值字符串代码，或该语言本身不支持")
    return opt


def determine_code_file_eval_opt(lang):
    opt = CODE_FILE_EVAL_OPT.get(lang, None)
    if opt is None:
        raise e.FeatureError(f"{lang}：当前实现/语言本身不支持运行文件")
    return opt


def determine_code_eval_opt(lang, code, *, program=None, shell=False):
    try:
        code_is_path = Path(code)
        code_is_file = code_is_path.is_file()
        code_is_absolute = code_is_path.is_absolute()
    except:
        code_is_path = code_is_file = code_is_absolute = False

    lang = lang.replace("-", "_")       # 兼容带连字符的语言名称，如 git-bash
    if code_is_path and code_is_file:
        if not code_is_absolute:
            raise e.FeatureError("如果要执行的是一个程序文件，则必须指定文件的绝对路径")
        code_eval_opt = determine_code_file_eval_opt(lang)
    elif program is not None or shell is False:
        code_eval_opt = determine_code_string_eval_opt(lang)
    else:
        code_eval_opt = ""
    return code_eval_opt


class LogEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Path):
            return str(obj)
        return json.JSONEncoder.default(self, obj)


class ExecutorCfgType(ModelCfgType):
    pass


@dataclass
class SubprocessConfig(metaclass=CfgSectionType):
    __parent_path__: InitVar[str]
    shell: t.Optional[bool] = False
    executable: t.Optional[t.Union[str, Path]] = field(default=None, metadata=dict(is_file=True))
    cwd: t.Optional[t.Union[str, Path]] = field(default=temp_dir, metadata=dict(is_dir=True))
    # TODO: timeout support
    # timeout: t.Optional[t.timeout_in_seconds] = field(default=5, metadata=dict(min=0, max=300))

    __doc__ = f"""
    支持配置的参数：
        , executable= [optional,filepath,default={{auto_guess}}]
        , cwd=        [optional,dirpath,default="{temp_dir}"]
    ==============
    暂不支持配置的参数
        , timeout=    [optional,int(seconds),default=5]
    ==============
    非配置参数(自动决定)
        , shell=      [optional,bool,default={{auto_detect}}]
"""


@dataclass
class MainConfig(metaclass=CfgSectionType):
    __parent_path__: InitVar[str]

    __doc__ = f"""暂未实现任何配置
"""


@dataclass()
class ExecutorConfig(metaclass=ExecutorCfgType):
    __parent_path__: InitVar[str]
    lang: str = field(metadata=dict(enum=support_langs))
    subprocess: SubprocessConfig
    main: MainConfig
    mainExtras: t.Optional[dict] = field(default_factory=dict)
    _subprocessShell: bool = False

    @classmethod
    @property
    def __doc__(cls):
        return f"""
    支持配置的参数
        , lang=       [required,str,values={list(support_langs)!s}]
        , subprocess: [required,dict]
        , main:       [required,dict]
    ============
    以下参数为脚本动态参数，而非 postman.settings 配置项
        , mainExtras: [optional,dict,default={{}}]
"""


class ExecutorAbstract(ABC):
    @staticmethod
    @abstractmethod
    def output(self, *args, **kwargs) -> Tuple[AnyStr, List[AnyStr]]:
        raise NotImplemented

    @abstractmethod
    async def execute(self, task_info: AnyStr, model_config: ModelCfgType) -> Any:
        raise NotImplemented

    def __init__(self, type=None):
        self.type = type


class Executor(ExecutorAbstract):
    @staticmethod
    async def _split_command(lang, code, cfg: SubprocessConfig):
        if not (isinstance(code, str) and code.strip()):
            raise e.FeatureError(f"无效的程序代码")
        bool_shell, executable, cwd = cfg.getmany(["shell", "executable", "cwd"])
        if lang != "generic" and bool_shell is True:
            raise e.FeatureError(f"若指定了特定语言，则@shell选项必须指定为`False`")

        cmd = code.strip()
        if bool_shell is True:
            program, code_eval_opt = None, None
        elif lang != "generic":
            if executable is not None:
                program = Path(executable)
                code_eval_opt = determine_code_eval_opt(lang, code, program=program, shell=bool_shell)
            else:
                program = Path(await guess_from_path(lang))
                code_eval_opt = determine_code_eval_opt(lang, code, program=program, shell=bool_shell)
        else:
            try:
                elements = json.loads(code)
                if not isinstance(elements, list):
                    raise TypeError
                if len(elements) == 0 or any(not isinstance(x, str) for x in elements):
                    raise TypeError
            except:
                raise e.FeatureError(f"发送的@script参数格式不正确")
            else:
                program, *cmd = elements
                program = Path(program)
                if executable is not None:
                    # @override
                    program = Path(executable)
                code_eval_opt = None

        extras = dict(
            cwd=cwd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        return (program, code_eval_opt), cmd, extras

    @staticmethod
    def output(decoded_result):
        return decoded_result, ()

    async def execute(self, code: str, cfg: FeatureCfg):
        type = cfg.get("lang")
        middleware_module = sys.modules[f"{__package__}.middleware"]
        if type in middleware_module.support_middlewares:
            return await middleware_module.query(type, code, cfg)

        self.type = type
        executor_cfg: ExecutorConfig = ExecutorConfig.get_model_cfg(cfg)
        subprocess_shell: bool = executor_cfg.get("_subprocessShell", False)
        subprocess_cfg: SubprocessConfig = SubprocessConfig.get_model_cfg(executor_cfg)
        subprocess_cfg.update(shell=subprocess_shell)
        (program, code_eval_opt), args, extras = await self._split_command(type, code, subprocess_cfg)
        if program is not None:
            if not (program.exists() and program.is_file()):
                warnings.warn(f'目标文件不存在："{program}"', e.FeatureWarning)
            if not isinstance(args, list):
                args = (args, ) if not code_eval_opt else (code_eval_opt, args)
            log.info("执行命令：%s", json.dumps(dict(
                method="create_subprocess_exec",
                program=program,
                args=args,
                extras=extras), cls=LogEncoder))
            process = await asyncio.create_subprocess_exec(program, *args, **extras)
        else:
            log.info("执行命令：%s", json.dumps(dict(
                method="create_subprocess_shell",
                args=args,
                extras=extras), cls=LogEncoder))
            process = await asyncio.create_subprocess_shell(args, **extras)
        stdout, stderr = await process.communicate()
        exit_status = process.returncode
        if exit_status != 0 or stderr:
            tag, msg = f"执行给定的命令/代码失败(exit_code={exit_status})：", "未知错误"
            raise e.FeatureError(tag + (decode(stderr) if stderr else msg))
        return self.output(decode(stdout) if stdout else "")
