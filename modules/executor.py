# -*- encoding: utf-8 -*-


__all__ = [
    "ExecutorConfig",
    "Executor",
    "get_supports_lang"
]


import sys
import json
import asyncio
import warnings
import dataclasses
import cchardet as chardet

from pathlib import Path

from . import e, t, FeatureCfg, ModelCfgType, log


cd = Path(__file__).parent
dataclass = dataclasses.dataclass


def get_supports_lang():
    return ("python",
            "php",
            "nodejs",
            "shell",
            "wincmd",
            "powershell",
            "git-bash",
            "wsl-bash",
            # generic - 无关联特定语言，命令行模式
            "generic")


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
        raise e.ExecutorError("命令已执行，但内容编码识别失败")
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
        raise e.GuessError(message + reason)
    if stdout:
        first_target = determine_real_target(tag_of_lang, decode(stdout))
        if first_target:
            return first_target
    raise e.GuessError(message)


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
        raise e.ExecutorError(f"{lang}：当前实现不支持求值字符串代码，或该语言本身不支持")
    return opt


def determine_code_file_eval_opt(lang):
    opt = CODE_FILE_EVAL_OPT.get(lang, None)
    if opt is None:
        raise e.ExecutorError(f"{lang}：当前实现/语言本身不支持运行文件")
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
            raise e.ExecutorError("如果要执行的是一个程序文件，则必须指定文件的绝对路径")
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


@dataclass()
class ExecutorConfig(metaclass=ExecutorCfgType):
    lang: t.executor_supports_lang
    executable: t.Optional[t.none_empty_str] = None
    cwd: t.Union[t.dirpath, Path] = cd.parent.joinpath("temp")
    timeout: t.timeout_in_seconds = 0
    shell: bool = False

    __doc__ = f"""
  lang=       [required,{get_supports_lang()!s}],
  executable= [optional,default=*guessed*],
  cwd=        [optional,default={cd.parent.joinpath("temp")!s}],
  shell=      [optional,default=False]
"""


class Executor(object):
    @staticmethod
    async def split_command(code, cfg: ExecutorConfig):
        if not (isinstance(code, str) and code.strip()):
            raise e.ExecutorError(f"无效的程序代码")
        if cfg.lang != "generic" and cfg.shell is True:
            raise e.ExecutorError(f"若指定了特定语言，则@shell选项必须指定为`False`")

        cmd = code.strip()
        if cfg.shell is True:
            program, code_eval_opt = None, None
        elif cfg.lang != "generic":
            if cfg.executable is not None:
                program = Path(cfg.executable)
                code_eval_opt = determine_code_eval_opt(cfg.lang, code, program=program, shell=cfg.shell)
            else:
                program = Path(await guess_from_path(cfg.lang))
                code_eval_opt = determine_code_eval_opt(cfg.lang, code, program=program, shell=cfg.shell)
        else:
            try:
                elements = json.loads(code)
                if not isinstance(elements, list):
                    raise TypeError
                if len(elements) == 0 or any(not isinstance(x, str) for x in elements):
                    raise TypeError
            except:
                raise e.ExecutorError(f"发送的@script参数格式不正确")
            else:
                program, *cmd = elements
                program = Path(program)
                if cfg.executable is not None:
                    # @override
                    program = Path(cfg.executable)
                code_eval_opt = None

        extras = dict(
            cwd=cfg.cwd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        return (program, code_eval_opt), cmd, extras

    async def exec(self, code: str, cfg: FeatureCfg):
        exec_cfg: ExecutorConfig = ExecutorConfig.get_model_cfg(cfg)
        (program, code_eval_opt), args, extras = await self.split_command(code, exec_cfg)
        if program is not None:
            if not (program.exists() and program.is_file()):
                warnings.warn(f'目标文件不存在："{program}"', e.ExecutorWarning)
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
            raise e.ExecutorError(tag + (decode(stderr) if stderr else msg))
        return decode(stdout) if stdout else ""
