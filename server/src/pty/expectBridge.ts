export const EXPECT_RESIZE_MARKER_PREFIX = "\u001b]1337;AgentPortResize=";
export const EXPECT_RESIZE_MARKER_SUFFIX = "\u0007";

export function buildExpectResizeMarker(cols: number, rows: number): string {
  return `${EXPECT_RESIZE_MARKER_PREFIX}${Math.max(20, Math.floor(cols))};${Math.max(5, Math.floor(rows))}${EXPECT_RESIZE_MARKER_SUFFIX}`;
}

export function buildExpectBridgeScript(command: string[], cols = 120, rows = 40): string {
  const commandList = toTclList(command);
  const safeCols = Math.max(20, Math.floor(cols));
  const safeRows = Math.max(5, Math.floor(rows));
  return `
set timeout -1
set cmd ${commandList}
spawn -noecho {*}$cmd
stty columns ${safeCols} rows ${safeRows} < $spawn_out(slave,name)
fconfigure stdin -translation binary -encoding utf-8 -blocking 0
fconfigure stdout -translation binary -encoding utf-8
proc forward_stdin {} {
  if {[eof stdin]} { return }
  set data [read stdin]
  while {[regexp -indices {\\x1b\\]1337;AgentPortResize=([0-9]+);([0-9]+)\\x07} $data match cols rows]} {
    set before [string range $data 0 [expr {[lindex $match 0] - 1}]]
    if {[string length $before] > 0} { send -- $before }
    set nextCols [string range $data [lindex $cols 0] [lindex $cols 1]]
    set nextRows [string range $data [lindex $rows 0] [lindex $rows 1]]
    stty columns $nextCols rows $nextRows < $spawn_out(slave,name)
    set data [string range $data [expr {[lindex $match 1] + 1}] end]
  }
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
