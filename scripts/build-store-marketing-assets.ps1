param(
  [string]$FfmpegPath = $env:HABHUB_FFMPEG,
  [switch]$SkipVideo
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$repoRoot = Split-Path -Parent $PSScriptRoot
$rawDirectory = Join-Path $repoRoot "store/source-captures/iphone-420x911"
$appleDirectory = Join-Path $repoRoot "store/exports/apple/iphone-6.9/en-US"
$googleDirectory = Join-Path $repoRoot "store/exports/google/phone/en-US"
$featureDirectory = Join-Path $repoRoot "store/exports/google/feature-graphic/en-US"
$videoFrameDirectory = Join-Path $repoRoot "store/exports/video/frames/en-US"
$appleVideoDirectory = Join-Path $repoRoot "store/exports/video/apple/en-US"
$googleVideoDirectory = Join-Path $repoRoot "store/exports/video/google/en-US"
$tourFrameDirectory = Join-Path $repoRoot "store/exports/video/feature-tour/frames/en-US"
$tourVideoDirectory = Join-Path $repoRoot "store/exports/video/feature-tour/en-US"
$socialDirectory = Join-Path $repoRoot "store/exports/social/en-US"

@(
  $appleDirectory,
  $googleDirectory,
  $featureDirectory,
  $videoFrameDirectory,
  $appleVideoDirectory,
  $googleVideoDirectory,
  $tourFrameDirectory,
  $tourVideoDirectory,
  $socialDirectory
) | ForEach-Object { [System.IO.Directory]::CreateDirectory($_) | Out-Null }

# These folders are generated artifacts owned by this script. Clear only the
# formats it emits so renamed/reordered scenes cannot leave stale store files
# that might be uploaded accidentally.
function Clear-GeneratedFiles {
  param([string]$Directory, [string]$Pattern)
  $resolvedRoot = [System.IO.Path]::GetFullPath($repoRoot)
  $resolvedDirectory = [System.IO.Path]::GetFullPath($Directory)
  if (-not $resolvedDirectory.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to clean a generated directory outside the repository: $resolvedDirectory"
  }
  foreach ($file in [System.IO.Directory]::GetFiles($resolvedDirectory, $Pattern)) {
    [System.IO.File]::Delete($file)
  }
}

Clear-GeneratedFiles $appleDirectory "*.png"
Clear-GeneratedFiles $googleDirectory "*.png"
Clear-GeneratedFiles $featureDirectory "*.png"
Clear-GeneratedFiles $videoFrameDirectory "*.png"
Clear-GeneratedFiles $appleVideoDirectory "*.mp4"
Clear-GeneratedFiles $googleVideoDirectory "*.mp4"
Clear-GeneratedFiles $tourFrameDirectory "*.png"
Clear-GeneratedFiles $tourVideoDirectory "*.mp4"
Clear-GeneratedFiles $socialDirectory "*.png"

$scenes = @(
  [pscustomobject]@{ Order = 1; Id = "today-personalized"; Raw = "01-today.jpg"; Headline = "YOUR DAY, YOUR WAY"; Subline = "Build Today around the goals that matter."; Apple = $true; Google = $true },
  [pscustomobject]@{ Order = 2; Id = "tracker-history"; Raw = "02-tracker-history.jpg"; Headline = "TRACK ANYTHING"; Subline = "Open every tracker for clear weekly history."; Apple = $true; Google = $true },
  [pscustomobject]@{ Order = 3; Id = "progress-grid"; Raw = "03-progress-grid.jpg"; Headline = "SEE THE PATTERN"; Subline = "Spot consistent days in the progress grid."; Apple = $true; Google = $true },
  [pscustomobject]@{ Order = 4; Id = "photo-collage"; Raw = "04-photo-collage.jpg"; Headline = "PHOTO PROGRESS, SIDE BY SIDE"; Subline = "Synthetic demo imagery - compare and collage privately."; Apple = $true; Google = $true },
  [pscustomobject]@{ Order = 5; Id = "workout"; Raw = "05-workout.jpg"; Headline = "TRAIN WITH A PLAN"; Subline = "Log sets, rests, time and workout history."; Apple = $true; Google = $true },
  [pscustomobject]@{ Order = 6; Id = "leaderboard"; Raw = "10-leaderboard.jpg"; Headline = "PROGRESS TOGETHER"; Subline = "Friendly rankings respect every member's privacy."; Apple = $true; Google = $true },
  [pscustomobject]@{ Order = 7; Id = "challenges"; Raw = "11-challenges.jpg"; Headline = "CHALLENGE YOUR CREW"; Subline = "Compete on shared goals with clear live standings."; Apple = $true; Google = $true },
  [pscustomobject]@{ Order = 8; Id = "recap-social"; Raw = "19-recap-social.jpg"; Headline = "EVERY WIN HAS A STORY"; Subline = "React and comment once across recap and feed."; Apple = $true; Google = $true },
  [pscustomobject]@{ Order = 9; Id = "custom-tracker"; Raw = "15-custom-tracker.jpg"; Headline = "MAKE THE TRACKER YOURS"; Subline = "Duplicate a proven style, then tune it to your goal."; Apple = $true; Google = $false },
  [pscustomobject]@{ Order = 10; Id = "guided-learning"; Raw = "12-quick-guide.jpg"; Headline = "LEARN BY DOING"; Subline = "Watch the pointer or practise safely with demo data."; Apple = $true; Google = $false },
  [pscustomobject]@{ Order = 11; Id = "schedule"; Raw = "07-schedule.jpg"; Headline = "REMEMBER THE ROUTINE"; Subline = "Schedule goals, reminders and to-dos together."; Apple = $false; Google = $false },
  [pscustomobject]@{ Order = 12; Id = "journal"; Raw = "07-journal.jpg"; Headline = "REFLECT, THEN ADJUST"; Subline = "Keep workouts, meals and weekly notes together."; Apple = $false; Google = $false },
  [pscustomobject]@{ Order = 13; Id = "group-chat"; Raw = "09-chat.jpg"; Headline = "ENCOURAGEMENT IN ONE PLACE"; Subline = "Private group chat, reactions and reminders."; Apple = $false; Google = $false },
  [pscustomobject]@{ Order = 14; Id = "badges"; Raw = "06-badges.jpg"; Headline = "MOMENTUM YOU CAN SEE"; Subline = "Badges turn small wins into lasting milestones."; Apple = $false; Google = $false },
  [pscustomobject]@{ Order = 15; Id = "status-avatar"; Raw = "08-status-avatar.jpg"; Headline = "A PROFILE THAT EVOLVES"; Subline = "Your avatar and progress move with your goals."; Apple = $false; Google = $false }
)

# The long-form product tour is intentionally separate from the time-limited
# store masters. Every beat points to a real, reviewable release-candidate
# capture; captions may explain the visible workflow but never invent UI.
$tourScenes = @(
  [pscustomobject]@{ Id = "today-overview"; Raw = "01-today.jpg"; Headline = "START WITH TODAY"; Subline = "Goals, to-dos and the signals you care about - in one calm home." },
  [pscustomobject]@{ Id = "today-edit"; Raw = "13-today-edit.jpg"; Headline = "SHAPE YOUR DAILY HOME"; Subline = "Enter edit mode to pin, hide, add and reorder without losing history."; Callout = "HOLD TO EDIT"; CalloutY = 0.25 },
  [pscustomobject]@{ Id = "goals-versus-todos"; Raw = "01-today.jpg"; Headline = "GOALS AND TO-DOS STAY DISTINCT"; Subline = "Show either section, both, or neither - your Today page follows your priorities." },
  [pscustomobject]@{ Id = "todo-batch"; Raw = "14-todo-batch.jpg"; Headline = "PASTE A WHOLE PLAN"; Subline = "Bullets, nested sub-to-dos and #labels become one reviewable structure."; Callout = "PASTE OUTLINE"; CalloutY = 0.48 },
  [pscustomobject]@{ Id = "todo-staged"; Raw = "14-todo-staged.jpg"; Headline = "REVIEW BEFORE YOU SAVE"; Subline = "Stage the outline, inspect the nested tasks, then save only when the structure is right."; Callout = "TAP STAGE"; CalloutY = 0.73 },
  [pscustomobject]@{ Id = "tracker-detail"; Raw = "02-tracker-history.jpg"; Headline = "OPEN ANY TRACKER"; Subline = "Move from today's value to dated entries and history in one tap." },
  [pscustomobject]@{ Id = "history-charts"; Raw = "02-tracker-history.jpg"; Headline = "READ THE TREND YOUR WAY"; Subline = "Line and bar views keep targets, totals and records in context." },
  [pscustomobject]@{ Id = "duplicate-style"; Raw = "15-custom-tracker.jpg"; Headline = "REUSE A TRACKER STYLE"; Subline = "Turn Water's plus-and-minus flow into study time, medicine, practice or anything else."; Callout = "DUPLICATE"; CalloutY = 0.34 },
  [pscustomobject]@{ Id = "food-nutrition"; Raw = "16-food-nutrition.jpg"; Headline = "NUTRITION WITH CONTEXT"; Subline = "See logged nutrients beside applicable daily references and personal goals." },
  [pscustomobject]@{ Id = "activity-timer"; Raw = "17-workout-timer.jpg"; Headline = "TIME AN ACTIVITY"; Subline = "Run a stopwatch or countdown and optionally save the result as a workout."; Callout = "START TIMER"; CalloutY = 0.76 },
  [pscustomobject]@{ Id = "timer-workout"; Raw = "17-workout-timer.jpg"; Headline = "ONE FINISH, CONNECTED LOGS"; Subline = "Duration, optional distance and energy flow into the matching trackers."; Callout = "SAVE TO WORKOUT"; CalloutY = 0.48 },
  [pscustomobject]@{ Id = "workout-plan"; Raw = "05-workout.jpg"; Headline = "TRAIN WITH A PLAN"; Subline = "Start from a template or build a session set by set." },
  [pscustomobject]@{ Id = "workout-live"; Raw = "05-workout.jpg"; Headline = "STAY IN THE WORKOUT"; Subline = "Complete sets, follow rest timing and keep the live session close." },
  [pscustomobject]@{ Id = "exercise-progress"; Raw = "18-exercise-progress.jpg"; Headline = "SEE EXERCISE PROGRESS"; Subline = "Compare average set load, best load, reps and estimated one-rep max." },
  [pscustomobject]@{ Id = "progress-grid"; Raw = "03-progress-grid.jpg"; Headline = "SEE THE PATTERN"; Subline = "Grid maps make consistency, gaps and comeback days visible." },
  [pscustomobject]@{ Id = "photo-timeline"; Raw = "04-photo-timeline.jpg"; Headline = "PHOTO PROGRESS OVER TIME"; Subline = "Five synthetic demo check-ins keep the visual journey private and dated." },
  [pscustomobject]@{ Id = "photo-compare"; Raw = "04-photo-collage.jpg"; Headline = "COMPARE SIDE BY SIDE"; Subline = "Choose meaningful dates and create a private collage from synthetic demo photos." },
  [pscustomobject]@{ Id = "avatar"; Raw = "08-status-avatar.jpg"; Headline = "A PROFILE THAT EVOLVES"; Subline = "Body-profile inputs shape an accessible progress view without medical claims." },
  [pscustomobject]@{ Id = "leaderboard"; Raw = "10-leaderboard.jpg"; Headline = "PROGRESS TOGETHER"; Subline = "Compare only the trackers and detail each person chose to share."; Callout = "OPEN GROUP TOOLS"; CalloutY = 0.22 },
  [pscustomobject]@{ Id = "challenges"; Raw = "11-challenges.jpg"; Headline = "CHALLENGE YOUR CREW"; Subline = "Pick a metric, target, dates and participants, then follow live standings." },
  [pscustomobject]@{ Id = "recap"; Raw = "19-recap-social.jpg"; Headline = "REPLAY THE GROUP STORY"; Subline = "Stories and feed entries stay linked to the same reactions and comments."; Callout = "REACT + COMMENT"; CalloutY = 0.72 },
  [pscustomobject]@{ Id = "group-schedule"; Raw = "20-group-schedule.jpg"; Headline = "PLAN SOMETHING TOGETHER"; Subline = "Share all-day or timed group events with optional notes." },
  [pscustomobject]@{ Id = "group-notes"; Raw = "21-group-notes.jpg"; Headline = "KEEP IDEAS OUT OF THE SCROLL"; Subline = "Shared notes have their own reactions, comments and permissions." },
  [pscustomobject]@{ Id = "chat"; Raw = "09-chat.jpg"; Headline = "KEEP THE CREW CLOSE"; Subline = "Group and direct conversations support quick reactions and safer controls." },
  [pscustomobject]@{ Id = "badges"; Raw = "06-badges.jpg"; Headline = "MOMENTUM YOU CAN SEE"; Subline = "Earned milestones, repeated challenge wins and showcase progress stay clear." },
  [pscustomobject]@{ Id = "schedule"; Raw = "07-schedule.jpg"; Headline = "REMEMBER THE ROUTINE"; Subline = "Bring planned goals, reminders and to-dos into one optional schedule." },
  [pscustomobject]@{ Id = "journal"; Raw = "07-journal.jpg"; Headline = "REFLECT, THEN ADJUST"; Subline = "Rich notes, labels, images and tracker links preserve the why behind the numbers." },
  [pscustomobject]@{ Id = "notifications"; Raw = "22-notifications.jpg"; Headline = "NOTIFY WITH INTENTION"; Subline = "Choose group, reminder, workout and milestone alerts - plus quiet hours." },
  [pscustomobject]@{ Id = "display"; Raw = "23-display-settings.jpg"; Headline = "KEEP ADVANCED CHOICES OPTIONAL"; Subline = "Reorder pages, simplify navigation and tune density, theme and layouts." },
  [pscustomobject]@{ Id = "profile-behavior"; Raw = "24-profile-behavior.jpg"; Headline = "YOU CONTROL THE ESTIMATES"; Subline = "Food-goal behavior and unrecorded-step estimates are explained and opt-in." },
  [pscustomobject]@{ Id = "quick-guides"; Raw = "12-quick-guide.jpg"; Headline = "LEARN PAGE BY PAGE"; Subline = "Watch the pointer or practise safely; every short tour can be skipped or replayed." },
  [pscustomobject]@{ Id = "menu"; Raw = "25-menu.jpg"; Headline = "POWER WITHOUT CLUTTER"; Subline = "Optional pages stay in the menu until you choose to pin them." }
)

function New-RoundedPath {
  param(
    [System.Drawing.RectangleF]$Rectangle,
    [float]$Radius
  )
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $Radius * 2
  $arc = [System.Drawing.RectangleF]::new($Rectangle.X, $Rectangle.Y, $diameter, $diameter)
  $path.AddArc($arc, 180, 90)
  $arc.X = $Rectangle.Right - $diameter
  $path.AddArc($arc, 270, 90)
  $arc.Y = $Rectangle.Bottom - $diameter
  $path.AddArc($arc, 0, 90)
  $arc.X = $Rectangle.Left
  $path.AddArc($arc, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-Canvas {
  param([int]$Width, [int]$Height)
  # Store artwork must be flattened. In particular, Google Play accepts 24-bit
  # PNGs without alpha for screenshots and feature graphics.
  $bitmap = [System.Drawing.Bitmap]::new(
    $Width,
    $Height,
    [System.Drawing.Imaging.PixelFormat]::Format24bppRgb
  )
  $bitmap.SetResolution(144, 144)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $rect = [System.Drawing.Rectangle]::new(0, 0, $Width, $Height)
  $navy = [System.Drawing.Color]::FromArgb(255, 8, 27, 73)
  $deepNavy = [System.Drawing.Color]::FromArgb(255, 4, 15, 43)
  $background = [System.Drawing.Drawing2D.LinearGradientBrush]::new($rect, $navy, $deepNavy, 90)
  $graphics.FillRectangle($background, $rect)
  $background.Dispose()

  $glow = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(34, 8, 189, 180))
  $graphics.FillEllipse($glow, -[int]($Width * 0.2), -[int]($Width * 0.12), [int]($Width * 0.9), [int]($Width * 0.72))
  $glow.Dispose()
  $coral = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(24, 255, 111, 97))
  $graphics.FillEllipse($coral, [int]($Width * 0.58), [int]($Height * 0.07), [int]($Width * 0.62), [int]($Width * 0.62))
  $coral.Dispose()
  return [pscustomobject]@{ Bitmap = $bitmap; Graphics = $graphics }
}

function Draw-ImagePanel {
  param(
    [System.Drawing.Graphics]$Graphics,
    [System.Drawing.Image]$Image,
    [System.Drawing.RectangleF]$Rectangle,
    [float]$Radius
  )
  $shadowRect = [System.Drawing.RectangleF]::new(
    $Rectangle.X,
    $Rectangle.Y + [Math]::Max(7, $Radius * 0.28),
    $Rectangle.Width,
    $Rectangle.Height
  )
  $shadowPath = New-RoundedPath $shadowRect $Radius
  $shadowBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(95, 0, 0, 0))
  $Graphics.FillPath($shadowBrush, $shadowPath)
  $shadowBrush.Dispose()
  $shadowPath.Dispose()

  $path = New-RoundedPath $Rectangle $Radius
  $saved = $Graphics.Save()
  $Graphics.SetClip($path)
  $Graphics.DrawImage($Image, $Rectangle)
  $Graphics.Restore($saved)
  $border = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(92, 255, 255, 255), [Math]::Max(1, $Radius * 0.06))
  $Graphics.DrawPath($border, $path)
  $border.Dispose()
  $path.Dispose()
}

function Draw-ImageCropPanel {
  param(
    [System.Drawing.Graphics]$Graphics,
    [System.Drawing.Image]$Image,
    [System.Drawing.RectangleF]$SourceRectangle,
    [System.Drawing.RectangleF]$TargetRectangle,
    [float]$Radius
  )
  $shadowRect = [System.Drawing.RectangleF]::new(
    $TargetRectangle.X,
    $TargetRectangle.Y + [Math]::Max(7, $Radius * 0.28),
    $TargetRectangle.Width,
    $TargetRectangle.Height
  )
  $shadowPath = New-RoundedPath $shadowRect $Radius
  $shadowBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(95, 0, 0, 0))
  $Graphics.FillPath($shadowBrush, $shadowPath)
  $shadowBrush.Dispose()
  $shadowPath.Dispose()

  $path = New-RoundedPath $TargetRectangle $Radius
  $saved = $Graphics.Save()
  $Graphics.SetClip($path)
  $Graphics.DrawImage(
    $Image,
    $TargetRectangle,
    $SourceRectangle,
    [System.Drawing.GraphicsUnit]::Pixel
  )
  $Graphics.Restore($saved)
  $border = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(92, 255, 255, 255), [Math]::Max(1, $Radius * 0.06))
  $Graphics.DrawPath($border, $path)
  $border.Dispose()
  $path.Dispose()
}

function Draw-BrandHeader {
  param(
    [System.Drawing.Graphics]$Graphics,
    [int]$Width,
    [int]$Height,
    [string]$Headline,
    [string]$Subline,
    [string]$Counter
  )
  $scale = $Width / 1080.0
  $padding = [float](58 * $scale)
  $markSize = [float](58 * $scale)
  $mark = [System.Drawing.Image]::FromFile((Join-Path $repoRoot "assets/images/habhub-splash-mark.png"))
  try {
    $Graphics.DrawImage($mark, $padding, [float](40 * $scale), $markSize, $markSize)
  } finally {
    $mark.Dispose()
  }
  $white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
  $muted = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(218, 224, 235, 249))
  $teal = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 8, 189, 180))
  $brandFont = [System.Drawing.Font]::new("Segoe UI", [float](32 * $scale), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $counterFont = [System.Drawing.Font]::new("Segoe UI", [float](21 * $scale), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $headlineSize = [float](64 * $scale)
  $headlineFont = $null
  do {
    if ($headlineFont) { $headlineFont.Dispose() }
    $headlineFont = [System.Drawing.Font]::new("Segoe UI", $headlineSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $headlineWidth = $Graphics.MeasureString($Headline, $headlineFont).Width
    $headlineSize -= [float](2 * $scale)
  } while ($headlineWidth -gt ($Width - 2 * $padding) -and $headlineSize -gt (39 * $scale))
  $sublineFont = [System.Drawing.Font]::new("Segoe UI", [float](29 * $scale), [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  try {
    $Graphics.DrawString("HabHub", $brandFont, $white, [float](128 * $scale), [float](49 * $scale))
    $counterFormat = [System.Drawing.StringFormat]::new()
    $counterFormat.Alignment = [System.Drawing.StringAlignment]::Far
    $Graphics.DrawString($Counter, $counterFont, $teal, [System.Drawing.RectangleF]::new([float]($Width - 250 * $scale), [float](54 * $scale), [float](190 * $scale), [float](35 * $scale)), $counterFormat)
    $counterFormat.Dispose()
    $Graphics.DrawString($Headline, $headlineFont, $white, [System.Drawing.RectangleF]::new($padding, [float](112 * $scale), [float]($Width - 2 * $padding), [float](86 * $scale)))
    $Graphics.DrawString($Subline, $sublineFont, $muted, [System.Drawing.RectangleF]::new($padding, [float](202 * $scale), [float]($Width - 2 * $padding), [float](80 * $scale)))
  } finally {
    $white.Dispose()
    $muted.Dispose()
    $teal.Dispose()
    $brandFont.Dispose()
    $counterFont.Dispose()
    $headlineFont.Dispose()
    $sublineFont.Dispose()
  }
}

function Draw-InteractionCallout {
  param(
    [System.Drawing.Graphics]$Graphics,
    [int]$Width,
    [int]$Height,
    [string]$Label,
    [double]$YFraction = 0.72
  )
  if ([string]::IsNullOrWhiteSpace($Label)) { return }
  $scale = $Width / 1080.0
  $font = [System.Drawing.Font]::new(
    "Segoe UI",
    [float](22 * $scale),
    [System.Drawing.FontStyle]::Bold,
    [System.Drawing.GraphicsUnit]::Pixel
  )
  $format = [System.Drawing.StringFormat]::new()
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $textSize = $Graphics.MeasureString($Label, $font)
  $pillWidth = [float]([Math]::Min($Width * 0.48, [Math]::Max(220 * $scale, $textSize.Width + 88 * $scale)))
  $pillHeight = [float](62 * $scale)
  $x = [float]($Width - $pillWidth - 42 * $scale)
  $y = [float]([Math]::Max($Height * 0.18, [Math]::Min($Height * 0.84, $Height * $YFraction)))
  $rectangle = [System.Drawing.RectangleF]::new($x, $y, $pillWidth, $pillHeight)
  $shadowRectangle = [System.Drawing.RectangleF]::new($x, [float]($y + 7 * $scale), $pillWidth, $pillHeight)
  $shadowPath = New-RoundedPath $shadowRectangle ([float](31 * $scale))
  $path = New-RoundedPath $rectangle ([float](31 * $scale))
  $shadow = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(105, 0, 0, 0))
  $background = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(235, 8, 27, 73))
  $border = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 8, 189, 180), [float](3 * $scale))
  $white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
  $tapFill = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 255, 111, 97))
  $tapRing = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(225, 255, 255, 255), [float](4 * $scale))
  try {
    $Graphics.FillPath($shadow, $shadowPath)
    $Graphics.FillPath($background, $path)
    $Graphics.DrawPath($border, $path)
    $textRectangle = [System.Drawing.RectangleF]::new($x, $y, [float]($pillWidth - 62 * $scale), $pillHeight)
    $Graphics.DrawString($Label, $font, $white, $textRectangle, $format)
    $tapSize = [float](34 * $scale)
    $tapX = [float]($x + $pillWidth - 47 * $scale)
    $tapY = [float]($y + ($pillHeight - $tapSize) / 2)
    $Graphics.DrawEllipse($tapRing, $tapX, $tapY, $tapSize, $tapSize)
    $Graphics.FillEllipse($tapFill, [float]($tapX + 9 * $scale), [float]($tapY + 9 * $scale), [float](16 * $scale), [float](16 * $scale))
  } finally {
    $font.Dispose()
    $format.Dispose()
    $shadowPath.Dispose()
    $path.Dispose()
    $shadow.Dispose()
    $background.Dispose()
    $border.Dispose()
    $white.Dispose()
    $tapFill.Dispose()
    $tapRing.Dispose()
  }
}

function New-StoreFrame {
  param(
    [string]$InputPath,
    [string]$OutputPath,
    [int]$Width,
    [int]$Height,
    [string]$Headline,
    [string]$Subline,
    [string]$Counter,
    [string]$Callout = "",
    [double]$CalloutY = 0.72
  )
  if (-not (Test-Path -LiteralPath $InputPath)) {
    throw "Missing real-app source capture: $InputPath"
  }
  $source = [System.Drawing.Image]::FromFile($InputPath)
  try {
    if ($source.Width -ne 420 -or $source.Height -ne 911) {
      throw "Source capture must be 420x911, got $($source.Width)x$($source.Height): $InputPath"
    }
    $canvas = New-Canvas $Width $Height
    try {
      Draw-BrandHeader $canvas.Graphics $Width $Height $Headline $Subline $Counter
      $headerHeight = [float]($Height * 0.145)
      if ([System.IO.Path]::GetFileName($InputPath) -eq "04-photo-collage.jpg") {
        $timeline = [System.Drawing.Image]::FromFile((Join-Path $rawDirectory "04-photo-timeline.jpg"))
        try {
          $timelineWidth = [float]($Width * 0.74)
          $timelineHeight = [float]($timelineWidth * (380 / 384))
          $timelineTarget = [System.Drawing.RectangleF]::new(
            [float]($Width * 0.055),
            [float]($headerHeight + $Height * 0.015),
            $timelineWidth,
            $timelineHeight
          )
          Draw-ImageCropPanel $canvas.Graphics $timeline ([System.Drawing.RectangleF]::new(18, 347, 384, 380)) $timelineTarget ([float]($Width * 0.022))

          $collageWidth = [float]($Width * 0.78)
          $collageHeight = [float]($collageWidth * (408 / 384))
          $collageTarget = [System.Drawing.RectangleF]::new(
            [float]($Width * 0.165),
            [float]($headerHeight + $Height * 0.335),
            $collageWidth,
            $collageHeight
          )
          Draw-ImageCropPanel $canvas.Graphics $source ([System.Drawing.RectangleF]::new(18, 0, 384, 408)) $collageTarget ([float]($Width * 0.022))
        } finally {
          $timeline.Dispose()
        }
      } else {
        $bottomMargin = [float]($Height * 0.026)
        $sideMargin = [float]($Width * 0.065)
        $availableWidth = $Width - (2 * $sideMargin)
        $availableHeight = $Height - $headerHeight - $bottomMargin
        $scale = [Math]::Min($availableWidth / $source.Width, $availableHeight / $source.Height)
        $targetWidth = [float]($source.Width * $scale)
        $targetHeight = [float]($source.Height * $scale)
        $targetX = [float](($Width - $targetWidth) / 2)
        $targetY = [float]($headerHeight + (($availableHeight - $targetHeight) / 2))
        $target = [System.Drawing.RectangleF]::new($targetX, $targetY, $targetWidth, $targetHeight)
        Draw-ImagePanel $canvas.Graphics $source $target ([float]($Width * 0.026))
      }
      Draw-InteractionCallout $canvas.Graphics $Width $Height $Callout $CalloutY
      $canvas.Bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $canvas.Graphics.Dispose()
      $canvas.Bitmap.Dispose()
    }
  } finally {
    $source.Dispose()
  }
}

$appleScenes = @($scenes | Where-Object Apple)
$googleScenes = @($scenes | Where-Object Google)

foreach ($scene in $appleScenes) {
  $input = Join-Path $rawDirectory $scene.Raw
  $output = Join-Path $appleDirectory ("{0:D2}-{1}.png" -f $scene.Order, $scene.Id)
  New-StoreFrame $input $output 1260 2736 $scene.Headline $scene.Subline ("{0:D2} / {1:D2}" -f $scene.Order, $appleScenes.Count)
}

foreach ($scene in $googleScenes) {
  $input = Join-Path $rawDirectory $scene.Raw
  $output = Join-Path $googleDirectory ("{0:D2}-{1}.png" -f $scene.Order, $scene.Id)
  New-StoreFrame $input $output 1080 1920 $scene.Headline $scene.Subline ("{0:D2} / {1:D2}" -f $scene.Order, $googleScenes.Count)
}

foreach ($scene in $scenes) {
  $input = Join-Path $rawDirectory $scene.Raw
  $output = Join-Path $videoFrameDirectory ("{0:D2}-{1}.png" -f $scene.Order, $scene.Id)
  New-StoreFrame $input $output 1080 1920 $scene.Headline $scene.Subline ("{0:D2} / {1:D2}" -f $scene.Order, $scenes.Count)
}

for ($tourIndex = 0; $tourIndex -lt $tourScenes.Count; $tourIndex += 1) {
  $scene = $tourScenes[$tourIndex]
  $input = Join-Path $rawDirectory $scene.Raw
  if (-not (Test-Path -LiteralPath $input)) {
    throw "Missing real-app source capture required by the feature tour: $($scene.Raw)"
  }
  $output = Join-Path $tourFrameDirectory ("{0:D2}-{1}.png" -f ($tourIndex + 1), $scene.Id)
  $callout = if ($scene.PSObject.Properties.Name -contains "Callout") { [string]$scene.Callout } else { "" }
  $calloutY = if ($scene.PSObject.Properties.Name -contains "CalloutY") { [double]$scene.CalloutY } else { 0.72 }
  New-StoreFrame $input $output 1080 1920 $scene.Headline $scene.Subline ("TOUR {0:D2} OF {1:D2}" -f ($tourIndex + 1), $tourScenes.Count) $callout $calloutY
}

$socialScenes = @(
  [pscustomobject]@{ Id = "today"; Raw = "01-today.jpg"; Headline = "BUILD A DAY THAT FITS"; Subline = "Goals, to-dos and flexible trackers in one personal home." },
  [pscustomobject]@{ Id = "progress"; Raw = "03-progress-grid.jpg"; Headline = "SMALL DAYS BECOME A PATTERN"; Subline = "History, grid maps and private photo comparisons make progress visible." },
  [pscustomobject]@{ Id = "together"; Raw = "19-recap-social.jpg"; Headline = "PROGRESS IS BETTER TOGETHER"; Subline = "Private groups connect leaderboards, challenges, stories and conversations." },
  [pscustomobject]@{ Id = "custom"; Raw = "15-custom-tracker.jpg"; Headline = "TRACK WHAT ACTUALLY MATTERS"; Subline = "Start simple, then duplicate and customise any tracker style." }
)
for ($socialIndex = 0; $socialIndex -lt $socialScenes.Count; $socialIndex += 1) {
  $scene = $socialScenes[$socialIndex]
  $input = Join-Path $rawDirectory $scene.Raw
  $output = Join-Path $socialDirectory ("{0:D2}-{1}-1080x1350.png" -f ($socialIndex + 1), $scene.Id)
  New-StoreFrame $input $output 1080 1350 $scene.Headline $scene.Subline ("HABHUB {0:D2}" -f ($socialIndex + 1))
}

function New-FeatureGraphic {
  $output = Join-Path $featureDirectory "habhub-feature-graphic-1024x500.png"
  $canvas = New-Canvas 1024 500
  $graphics = $canvas.Graphics
  $white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
  $muted = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(220, 224, 235, 249))
  $teal = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 8, 189, 180))
  $mark = [System.Drawing.Image]::FromFile((Join-Path $repoRoot "assets/images/habhub-splash-mark.png"))
  $headline = [System.Drawing.Font]::new("Segoe UI", 47, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $subline = [System.Drawing.Font]::new("Segoe UI", 23, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $brand = [System.Drawing.Font]::new("Segoe UI", 24, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $label = [System.Drawing.Font]::new("Segoe UI", 17, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  try {
    $graphics.DrawImage($mark, 54, 42, 52, 52)
    $graphics.DrawString("HabHub", $brand, $white, 116, 53)
    $graphics.DrawString("TRACK ANYTHING.`nPROGRESS TOGETHER.", $headline, $white, [System.Drawing.RectangleF]::new(54, 125, 390, 130))
    $graphics.DrawString("One flexible home for goals, workouts, progress and accountability.", $subline, $muted, [System.Drawing.RectangleF]::new(54, 280, 360, 105))
    $graphics.DrawString("REAL APP  |  SYNTHETIC DEMO DATA", $label, $teal, 54, 424)

    $panels = @(
      [pscustomobject]@{ File = "01-today.jpg"; X = 450; Y = 69 },
      [pscustomobject]@{ File = "03-progress-grid.jpg"; X = 638; Y = 42 },
      [pscustomobject]@{ File = "04-photo-collage.jpg"; X = 826; Y = 69 }
    )
    foreach ($panel in $panels) {
      $image = [System.Drawing.Image]::FromFile((Join-Path $rawDirectory $panel.File))
      try {
        Draw-ImagePanel $graphics $image ([System.Drawing.RectangleF]::new($panel.X, $panel.Y, 172, 373)) 18
      } finally {
        $image.Dispose()
      }
    }
    $canvas.Bitmap.Save($output, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $mark.Dispose()
    $headline.Dispose()
    $subline.Dispose()
    $brand.Dispose()
    $label.Dispose()
    $white.Dispose()
    $muted.Dispose()
    $teal.Dispose()
    $graphics.Dispose()
    $canvas.Bitmap.Dispose()
  }
  return $output
}

function New-VideoOutro {
  $output = Join-Path $videoFrameDirectory "13-habhub-outro.png"
  $canvas = New-Canvas 1080 1920
  $graphics = $canvas.Graphics
  $mark = [System.Drawing.Image]::FromFile((Join-Path $repoRoot "assets/images/habhub-splash-mark.png"))
  $white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
  $muted = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(220, 224, 235, 249))
  $teal = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 8, 189, 180))
  $brand = [System.Drawing.Font]::new("Segoe UI", 96, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $tagline = [System.Drawing.Font]::new("Segoe UI", 42, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $label = [System.Drawing.Font]::new("Segoe UI", 24, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $center = [System.Drawing.StringFormat]::new()
  $center.Alignment = [System.Drawing.StringAlignment]::Center
  try {
    $graphics.DrawImage($mark, 390, 260, 300, 300)
    $graphics.DrawString("HabHub", $brand, $white, [System.Drawing.RectangleF]::new(80, 600, 920, 130), $center)
    $graphics.DrawString("Track anything. Progress together.", $tagline, $muted, [System.Drawing.RectangleF]::new(80, 745, 920, 120), $center)
    $graphics.DrawString("REAL APP  |  SYNTHETIC DEMO DATA", $label, $teal, [System.Drawing.RectangleF]::new(80, 885, 920, 50), $center)

    $panels = @(
      [pscustomobject]@{ File = "01-today.jpg"; X = 45; Y = 1080 },
      [pscustomobject]@{ File = "03-progress-grid.jpg"; X = 370; Y = 1030 },
      [pscustomobject]@{ File = "04-photo-collage.jpg"; X = 695; Y = 1080 }
    )
    foreach ($panel in $panels) {
      $image = [System.Drawing.Image]::FromFile((Join-Path $rawDirectory $panel.File))
      try {
        Draw-ImagePanel $graphics $image ([System.Drawing.RectangleF]::new($panel.X, $panel.Y, 340, 738)) 26
      } finally {
        $image.Dispose()
      }
    }
    $canvas.Bitmap.Save($output, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $mark.Dispose()
    $white.Dispose()
    $muted.Dispose()
    $teal.Dispose()
    $brand.Dispose()
    $tagline.Dispose()
    $label.Dispose()
    $center.Dispose()
    $graphics.Dispose()
    $canvas.Bitmap.Dispose()
  }
  return $output
}

$featureGraphic = New-FeatureGraphic
$outroFrame = New-VideoOutro

function Resolve-Ffmpeg {
  if ($FfmpegPath -and (Test-Path -LiteralPath $FfmpegPath)) {
    return (Resolve-Path -LiteralPath $FfmpegPath).Path
  }
  $command = Get-Command ffmpeg -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $known = "C:\Program Files\Lenovo\LegionSpace\1.9.11.6\gamingai\services\editor\ffmpeg.exe"
  if (Test-Path -LiteralPath $known) { return $known }
  throw "ffmpeg was not found. Set HABHUB_FFMPEG to an ffmpeg 6+ executable with an H.264 encoder."
}

function New-FadeVideo {
  param(
    [string[]]$Frames,
    [string]$OutputPath,
    [double]$SlideDuration,
    [double]$FadeDuration,
    [int]$Width = 1080,
    [int]$Height = 1920,
    [switch]$Motion
  )
  $ffmpeg = Resolve-Ffmpeg
  $encoders = (& $ffmpeg -hide_banner -encoders 2>&1 | Out-String)
  $encoderCandidates = @("libx264", "h264_nvenc", "h264_mf", "h264_qsv", "h264_amf") | Where-Object { $encoders -match "\b$($_)\b" }
  if (-not $encoderCandidates.Count) { throw "No supported H.264 encoder was found in $ffmpeg" }

  $totalDuration = $Frames.Count * $SlideDuration
  $inputArguments = @()
  foreach ($frame in $Frames) {
    $inputArguments += @("-loop", "1", "-framerate", "30", "-t", $SlideDuration.ToString("0.###", [Globalization.CultureInfo]::InvariantCulture), "-i", $frame)
  }
  $inputArguments += @("-f", "lavfi", "-t", $totalDuration.ToString("0.###", [Globalization.CultureInfo]::InvariantCulture), "-i", "anullsrc=r=48000:cl=stereo")

  $filters = [System.Collections.Generic.List[string]]::new()
  $concatInputs = [System.Collections.Generic.List[string]]::new()
  $fadeOutStart = ($SlideDuration - $FadeDuration).ToString("0.###", [Globalization.CultureInfo]::InvariantCulture)
  $fadeText = $FadeDuration.ToString("0.###", [Globalization.CultureInfo]::InvariantCulture)
  for ($index = 0; $index -lt $Frames.Count; $index += 1) {
    $motionFilter = if ($Motion) {
      "scale=$Width`:$Height`:flags=lanczos,zoompan=z='min(zoom+0.0004,1.036)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=$($Width)x$($Height):fps=30"
    } else {
      "fps=30,scale=$Width`:$Height`:flags=lanczos"
    }
    $filters.Add("[$index`:v]$motionFilter,setsar=1,format=yuv420p,fade=t=in:st=0:d=$fadeText`:color=0x08131F,fade=t=out:st=$fadeOutStart`:d=$fadeText`:color=0x08131F,settb=AVTB,setpts=PTS-STARTPTS[v$index]")
    $concatInputs.Add("[v$index]")
  }
  $filters.Add("$($concatInputs -join '')concat=n=$($Frames.Count):v=1:a=0[vout]")
  $filterGraph = $filters -join ";"

  $lastError = ""
  foreach ($encoder in $encoderCandidates) {
    $arguments = @("-y", "-hide_banner", "-loglevel", "error") + $inputArguments + @(
      "-filter_complex", $filterGraph,
      "-map", "[vout]",
      "-map", "$($Frames.Count):a",
      "-t", $totalDuration.ToString("0.###", [Globalization.CultureInfo]::InvariantCulture),
      "-c:v", $encoder,
      "-b:v", "8M",
      "-maxrate", "12M",
      "-bufsize", "16M",
      "-profile:v", "high",
      "-pix_fmt", "yuv420p",
      "-r", "30",
      "-c:a", "aac",
      "-b:a", "128k",
      "-ar", "48000",
      "-movflags", "+faststart",
      $OutputPath
    )
    $result = & $ffmpeg @arguments 2>&1
    if ($LASTEXITCODE -eq 0) { return }
    $lastError = ($result | Select-Object -Last 8 | Out-String)
  }
  throw "All available H.264 encoders failed for $OutputPath`n$lastError"
}

if (-not $SkipVideo) {
  $storeVideoScenes = @($scenes | Select-Object -First 12)
  $videoFrames = @(
    $storeVideoScenes | ForEach-Object {
      Join-Path $videoFrameDirectory ("{0:D2}-{1}.png" -f $_.Order, $_.Id)
    }
  ) + @($outroFrame)
  # Every duration is aligned to 30 fps. Independent fade-to-brand transitions
  # are robust across the software and hardware H.264 encoders used on Windows.
  New-FadeVideo $videoFrames (Join-Path $appleVideoDirectory "habhub-apple-master-886x1920.mp4") 2.3 0.2 886 1920
  New-FadeVideo $videoFrames (Join-Path $googleVideoDirectory "habhub-google-master-1080x1920.mp4") 3.45 0.2
  $tourFrames = @(
    0..($tourScenes.Count - 1) | ForEach-Object {
      Join-Path $tourFrameDirectory ("{0:D2}-{1}.png" -f ($_ + 1), $tourScenes[$_].Id)
    }
  ) + @($outroFrame)
  New-FadeVideo $tourFrames (Join-Path $tourVideoDirectory "habhub-comprehensive-feature-tour-1080x1920.mp4") 3.0 0.2 1080 1920 -Motion
  Write-Host "Created store screenshots, social highlights, feature graphic, and three still-screen H.264/AAC montage masters."
} else {
  Write-Host "Created store screenshots, social highlights, feature graphic, and video frames (video encoding skipped)."
}

Write-Host "Apple screenshots: $appleDirectory"
Write-Host "Google screenshots: $googleDirectory"
Write-Host "Feature graphic: $featureGraphic"
Write-Host "Feature tour: $tourVideoDirectory"
Write-Host "Separate live interaction guide: pnpm.cmd capture:interactive-guide:web"
