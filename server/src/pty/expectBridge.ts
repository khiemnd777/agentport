export function buildExpectBridgeScript(command: string[]): string {
  const commandList = toTclList(command);
  return `
set timeout -1
set cmd ${commandList}
spawn -noecho {*}$cmd
fconfigure stdin -translation binary -encoding utf-8 -blocking 0
fconfigure stdout -translation binary -encoding utf-8
proc forward_stdin {} {
  if {[eof stdin]} { return }
  set data [read stdin]
  if {[string length $data] > 0} { send -- $data }
}
fileevent stdin readable forward_stdin
expect {
  -re {(.|\\n)+} {
    puts -nonewline $expect_out(buffer)
    flush stdout
    exp_continue
  }
  eof {}
}
`;
}

function toTclList(values: string[]): string {
  return `[list ${values.map(toTclBracedWord).join(" ")}]`;
}

function toTclBracedWord(value: string): string {
  return `{${value.replaceAll("\\", "\\\\").replaceAll("{", "\\{").replaceAll("}", "\\}")}}`;
}
