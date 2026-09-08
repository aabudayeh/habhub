param(
  [string]$FfmpegPath = $env:HABHUB_FFMPEG,
  [string]$OutputDirectory = "",
  [switch]$SkipVideo
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$repoRoot = Split-Path -Parent $PSScriptRoot
$rawDirectory = Join-Path $repoRoot "store/source-captures/iphone-420x911"
$exportsRoot = if ($OutputDirectory) { [System.IO.Path]::GetFullPath($OutputDirectory) } else { Join-Path $repoRoot "store/exports" }
$permittedRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "store/exports"))
if ($exportsRoot -ne $permittedRoot -and -not $exportsRoot.StartsWith($permittedRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Marketing exports must stay inside store/exports: $exportsRoot"
}
$appleDirectory = Join-Path $exportsRoot "apple/iphone-6.9/en-US"
$googleDirectory = Join-Path $exportsRoot "google/phone/en-US"
$featureDirectory = Join-Path $exportsRoot "google/feature-graphic/en-US"
$videoFrameDirectory = Join-Path $exportsRoot "video/frames/en-US"
$appleVideoFrameDirectory = Join-Path $exportsRoot "video/apple-frames/en-US"
$appleVideoDirectory = Join-Path $exportsRoot "video/apple/en-US"
$googleVideoDirectory = Join-Path $exportsRoot "video/google/en-US"
$tourFrameDirectory = Join-Path $exportsRoot "video/feature-tour/frames/en-US"
$tourVideoDirectory = Join-Path $exportsRoot "video/feature-tour/en-US"
$socialDirectory = Join-Path $exportsRoot "social/en-US"

@(
  $appleDirectory,
  $googleDirectory,
  $featureDirectory,
  $videoFrameDirectory,
  $appleVideoFrameDirectory,
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
  if (-not $resolvedDirectory.StartsWith($resolvedRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
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
Clear-GeneratedFiles $appleVideoFrameDirectory "*.png"
Clear-GeneratedFiles $tourFrameDirectory "*.png"
Clear-GeneratedFiles $socialDirectory "*.png"
if (-not $SkipVideo) {
  Clear-GeneratedFiles $appleVideoDirectory "*.mp4"
  Clear-GeneratedFiles $googleVideoDirectory "*.mp4"
  Clear-GeneratedFiles $tourVideoDirectory "*.mp4"
}

$scenes = @(
  [pscustomobject]@{ Order = 1; Id = "today-personalized"; Raw = "01-today.jpg"; Headline = "Your day.`nYour way."; Subline = "Your goals, habits and to-dos. One personal home."; Apple = $true; Google = $true },
  [pscustomobject]@{ Order = 2; Id = "tracker-history"; Raw = "02-tracker-history.jpg"; Headline = "Small check-ins.`nA clearer picture."; Subline = "See the story behind every tracker."; Apple = $true; Google = $true },
  [pscustomobject]@{ Order = 3; Id = "progress-grid"; Raw = "03-progress-grid.jpg"; Headline = "Find your rhythm."; Subline = "See consistent days, fresh starts and everything between."; Apple = $true; Google = $true },
  [pscustomobject]@{ Order = 4; Id = "photo-collage"; Raw = "04-photo-collage.jpg"; Headline = "Your journey.`nSide by side."; Subline = "Compare check-ins and make a photo collage."; Apple = $true; Google = $true },
  [pscustomobject]@{ Order = 5; Id = "workout"; Raw = "05-workout.jpg"; Headline = "More focus.`nEvery session."; Subline = "Plan your workout. Log sets. Follow your progress."; Apple = $true; Google = $true },
  [pscustomobject]@{ Order = 6; Id = "leaderboard"; Raw = "10-leaderboard.jpg"; Headline = "Find your people.`nBuild momentum."; Subline = "Compare the goals you choose to share."; Apple = $true; Google = $true },
  [pscustomobject]@{ Order = 7; Id = "challenges"; Raw = "11-challenges.jpg"; Headline = "A little challenge.`nA shared goal."; Subline = "Bring your crew together around what matters."; Apple = $true; Google = $true },
  [pscustomobject]@{ Order = 8; Id = "recap-social"; Raw = "19-recap-social.jpg"; Headline = "Every win`nhas a story."; Subline = "React, comment and celebrate in one conversation."; Apple = $true; Google = $true },
  [pscustomobject]@{ Order = 9; Id = "custom-tracker"; Raw = "15-custom-tracker.jpg"; Headline = "Track what`nmatters to you."; Subline = "Reuse a style. Make it your own."; Apple = $true; Google = $false },
  [pscustomobject]@{ Order = 10; Id = "guided-learning"; Raw = "26-live-setup.jpg"; Headline = "Start simple.`nLearn as you go."; Subline = "Make Today yours while you use it. Skip tips anytime."; Apple = $true; Google = $false },
  [pscustomobject]@{ Order = 11; Id = "schedule"; Raw = "07-schedule.jpg"; Headline = "Make room`nfor your routine."; Subline = "Goals, reminders and to-dos in one schedule."; Apple = $false; Google = $false },
  [pscustomobject]@{ Order = 12; Id = "journal"; Raw = "07-journal.jpg"; Headline = "More than`nthe numbers."; Subline = "Keep notes about what is working for you."; Apple = $false; Google = $false },
  [pscustomobject]@{ Order = 13; Id = "group-chat"; Raw = "09-chat.jpg"; Headline = "A little`nencouragement."; Subline = "Stay close with group chat and quick reactions."; Apple = $false; Google = $false },
  [pscustomobject]@{ Order = 14; Id = "badges"; Raw = "06-badges.jpg"; Headline = "Make your`nsmall wins count."; Subline = "Keep earned badges and milestones in view."; Apple = $false; Google = $false },
  [pscustomobject]@{ Order = 15; Id = "status-avatar"; Raw = "08-status-avatar.jpg"; Headline = "Your progress.`nA personal view."; Subline = "Explore your profile, avatar and goals together."; Apple = $false; Google = $false }
)

# The long-form product tour is intentionally separate from the time-limited
# store masters. Every beat points to a real, reviewable release-candidate
# capture; captions may explain the visible workflow but never invent UI.
$tourScenes = @(
  [pscustomobject]@{ Id = "today-overview"; Raw = "01-today.jpg"; Headline = "Start with Today."; Subline = "Your goals, to-dos and everyday trackers share one personal home." },
  [pscustomobject]@{ Id = "live-setup"; Raw = "26-live-setup.jpg"; Headline = "Set up as you explore."; Subline = "Tap to personalize your real Today page. Skip all tips whenever you like." },
  [pscustomobject]@{ Id = "today-edit"; Raw = "13-today-edit.jpg"; Headline = "Make space for your day."; Subline = "Pin, hide and reorder the things you want to see."; Callout = "HOLD TO EDIT"; CalloutY = 0.25 },
  [pscustomobject]@{ Id = "goals-versus-todos"; Raw = "01-today.jpg"; Headline = "Your day. Your priorities."; Subline = "Keep goals, to-dos, both or neither. You choose." },
  [pscustomobject]@{ Id = "todo-batch"; Raw = "14-todo-batch.jpg"; Headline = "Paste a whole plan."; Subline = "Turn bullets and nested tasks into one organised outline."; Callout = "PASTE OUTLINE"; CalloutY = 0.48 },
  [pscustomobject]@{ Id = "todo-staged"; Raw = "14-todo-staged.jpg"; Headline = "See it before you save."; Subline = "Review your tasks, subtasks and #labels together."; Callout = "TAP STAGE"; CalloutY = 0.73 },
  [pscustomobject]@{ Id = "tracker-detail"; Raw = "02-tracker-history.jpg"; Headline = "Look beyond today."; Subline = "Open a tracker to explore its entries and history." },
  [pscustomobject]@{ Id = "history-charts"; Raw = "02-tracker-history.jpg"; Headline = "Find the story in the data."; Subline = "Switch chart views to put your progress in context." },
  [pscustomobject]@{ Id = "duplicate-style"; Raw = "15-custom-tracker.jpg"; Headline = "A familiar style. A new goal."; Subline = "Reuse plus-and-minus logging for study time, practice or your own goal."; Callout = "DUPLICATE"; CalloutY = 0.34 },
  [pscustomobject]@{ Id = "food-nutrition"; Raw = "16-food-nutrition.jpg"; Headline = "Give nutrition some context."; Subline = "See nutrient logs beside daily references and personal targets." },
  [pscustomobject]@{ Id = "activity-timer"; Raw = "17-workout-timer.jpg"; Headline = "Make time count."; Subline = "Start a stopwatch or countdown for the activity you choose."; Callout = "START TIMER"; CalloutY = 0.76 },
  [pscustomobject]@{ Id = "timer-workout"; Raw = "17-workout-timer.jpg"; Headline = "One activity. Connected logs."; Subline = "Save duration, distance and energy alongside your workout."; Callout = "SAVE TO WORKOUT"; CalloutY = 0.48 },
  [pscustomobject]@{ Id = "workout-plan"; Raw = "05-workout.jpg"; Headline = "Go in with a plan."; Subline = "Use a template or build a workout set by set." },
  [pscustomobject]@{ Id = "workout-live"; Raw = "05-workout.jpg"; Headline = "Stay with your session."; Subline = "Log sets, follow rest timing and keep your workout close." },
  [pscustomobject]@{ Id = "exercise-progress"; Raw = "18-exercise-progress.jpg"; Headline = "See what is changing."; Subline = "Compare average set load, reps and estimated one-rep max." },
  [pscustomobject]@{ Id = "progress-grid"; Raw = "03-progress-grid.jpg"; Headline = "Find your rhythm."; Subline = "See consistent days, gaps and fresh starts in the grid." },
  [pscustomobject]@{ Id = "photo-timeline"; Raw = "04-photo-timeline.jpg"; Headline = "Check in. Look back."; Subline = "Explore dated progress photos along your personal timeline." },
  [pscustomobject]@{ Id = "photo-compare"; Raw = "04-photo-collage.jpg"; Headline = "Your journey. Side by side."; Subline = "Compare selected check-ins and create a photo collage." },
  [pscustomobject]@{ Id = "avatar"; Raw = "08-status-avatar.jpg"; Headline = "A more personal view."; Subline = "Explore your avatar, body profile and tracked goals together." },
  [pscustomobject]@{ Id = "leaderboard"; Raw = "10-leaderboard.jpg"; Headline = "Find your people."; Subline = "Compare only the trackers and details each person shares."; Callout = "OPEN GROUP TOOLS"; CalloutY = 0.22 },
  [pscustomobject]@{ Id = "challenges"; Raw = "11-challenges.jpg"; Headline = "Give your crew a goal."; Subline = "Choose a challenge, participants and dates. Follow the standings." },
  [pscustomobject]@{ Id = "recap"; Raw = "19-recap-social.jpg"; Headline = "Every win has a story."; Subline = "Reactions and comments connect your recap with the group feed."; Callout = "REACT + COMMENT"; CalloutY = 0.72 },
  [pscustomobject]@{ Id = "group-schedule"; Raw = "20-group-schedule.jpg"; Headline = "Make a plan together."; Subline = "Share group events, times and notes in one schedule." },
  [pscustomobject]@{ Id = "group-notes"; Raw = "21-group-notes.jpg"; Headline = "Keep the good ideas close."; Subline = "Group notes keep plans, reactions and comments easy to find." },
  [pscustomobject]@{ Id = "chat"; Raw = "09-chat.jpg"; Headline = "A little encouragement."; Subline = "Keep talking with group chat, direct messages and quick reactions." },
  [pscustomobject]@{ Id = "badges"; Raw = "06-badges.jpg"; Headline = "Let small wins show."; Subline = "Keep earned badges and personal milestones in view." },
  [pscustomobject]@{ Id = "schedule"; Raw = "07-schedule.jpg"; Headline = "Make room for your routine."; Subline = "Bring planned goals, reminders and tasks into one optional schedule." },
  [pscustomobject]@{ Id = "journal"; Raw = "07-journal.jpg"; Headline = "More than the numbers."; Subline = "Add notes, photos and tracker links to your journal." },
  [pscustomobject]@{ Id = "notifications"; Raw = "22-notifications.jpg"; Headline = "Choose what gets your attention."; Subline = "Set notification categories, reminders and quiet hours." },
  [pscustomobject]@{ Id = "display"; Raw = "23-display-settings.jpg"; Headline = "Keep your app feeling like you."; Subline = "Tune your theme, page order and navigation." },
  [pscustomobject]@{ Id = "profile-behavior"; Raw = "24-profile-behavior.jpg"; Headline = "Understand your estimates."; Subline = "Explore the optional food-goal and unrecorded-step settings." },
  [pscustomobject]@{ Id = "quick-guides"; Raw = "12-quick-guide.jpg"; Headline = "Learn a little. Then explore."; Subline = "Watch a short guide, try it yourself or skip ahead." },
  [pscustomobject]@{ Id = "menu"; Raw = "25-menu.jpg"; Headline = "Your app. Your way."; Subline = "Your profile and settings, neatly in one place." }
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
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $rect = [System.Drawing.Rectangle]::new(0, 0, $Width, $Height)
  $navy = [System.Drawing.Color]::FromArgb(255, 15, 35, 55)
  $deepNavy = [System.Drawing.Color]::FromArgb(255, 5, 15, 30)
  $background = [System.Drawing.Drawing2D.LinearGradientBrush]::new($rect, $navy, $deepNavy, 90)
  $graphics.FillRectangle($background, $rect)
  $background.Dispose()

  $glow = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(10, 8, 189, 180))
  $graphics.FillEllipse($glow, [int]($Width * 0.22), [int]($Height * 0.23), [int]($Width * 1.1), [int]($Width * 1.1))
  $glow.Dispose()
  $orbit = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(18, 116, 198, 205), [float]([Math]::Max(1, $Width / 700.0)))
  $graphics.DrawEllipse($orbit, [float](-$Width * 0.75), [float]($Height * 0.18), [float]($Width * 1.9), [float]($Width * 1.9))
  $orbit.Dispose()
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
  # Capture coordinates describe the 420x911 CSS viewport. Higher-density
  # captures preserve the same viewport and scale these reference coordinates.
  $captureScale = $Image.Width / 420.0
  $scaledSourceRectangle = [System.Drawing.RectangleF]::new(
    [float]($SourceRectangle.X * $captureScale),
    [float]($SourceRectangle.Y * $captureScale),
    [float]($SourceRectangle.Width * $captureScale),
    [float]($SourceRectangle.Height * $captureScale)
  )
  $Graphics.DrawImage(
    $Image,
    $TargetRectangle,
    $scaledSourceRectangle,
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
    [string]$Category
  )
  $scale = $Width / 1080.0
  $padding = [float](66 * $scale)
  $markSize = [float](50 * $scale)
  $mark = [System.Drawing.Image]::FromFile((Join-Path $repoRoot "assets/images/habhub-splash-mark.png"))
  try {
    $Graphics.DrawImage($mark, $padding, [float](43 * $scale), $markSize, $markSize)
  } finally {
    $mark.Dispose()
  }
  $white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
  $muted = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 189, 208, 222))
  $teal = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 107, 218, 206))
  $brandFont = [System.Drawing.Font]::new("Segoe UI", [float](30 * $scale), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $categoryFont = [System.Drawing.Font]::new("Segoe UI", [float](19 * $scale), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  if ($Headline -ceq $Headline.ToUpperInvariant()) {
    $Headline = $Headline.Substring(0, 1) + $Headline.Substring(1).ToLowerInvariant()
  }
  $headlineSize = [float](86 * $scale)
  $headlineFont = $null
  $textWidth = [int]($Width - 2 * $padding)
  if (-not $Headline.Contains("`n")) {
    $probeFont = [System.Drawing.Font]::new("Segoe UI", $headlineSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    try {
      if ($Graphics.MeasureString($Headline, $probeFont).Width -gt $textWidth) {
        $words = $Headline.Split(' ', [System.StringSplitOptions]::RemoveEmptyEntries)
        $bestWidth = [double]::PositiveInfinity
        $balancedHeadline = $Headline
        for ($breakAt = 1; $breakAt -lt $words.Length; $breakAt += 1) {
          $firstLine = $words[0..($breakAt - 1)] -join ' '
          $secondLine = $words[$breakAt..($words.Length - 1)] -join ' '
          $lineWidth = [Math]::Max($Graphics.MeasureString($firstLine, $probeFont).Width, $Graphics.MeasureString($secondLine, $probeFont).Width)
          if ($lineWidth -lt $bestWidth) {
            $bestWidth = $lineWidth
            $balancedHeadline = "$firstLine`n$secondLine"
          }
        }
        $Headline = $balancedHeadline
      }
    } finally { $probeFont.Dispose() }
  }
  do {
    if ($headlineFont) { $headlineFont.Dispose() }
    $headlineFont = [System.Drawing.Font]::new("Segoe UI", $headlineSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $headlineMeasure = $Graphics.MeasureString($Headline, $headlineFont, $textWidth)
    $headlineSize -= [float](2 * $scale)
  } while ($headlineMeasure.Height -gt (2.15 * $headlineFont.GetHeight($Graphics)) -and $headlineSize -ge (58 * $scale))
  if ($headlineMeasure.Height -gt (2.15 * $headlineFont.GetHeight($Graphics))) { throw "Headline exceeds two lines: $Headline" }
  $headlineTop = [float](124 * $scale)
  $sublineTop = [float]($headlineTop + $headlineMeasure.Height + 12 * $scale)
  $sublineFont = [System.Drawing.Font]::new("Segoe UI", [float](30 * $scale), [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $sublineMeasure = $Graphics.MeasureString($Subline, $sublineFont, $textWidth)
  if ($sublineMeasure.Height -gt (2.15 * $sublineFont.GetHeight($Graphics))) { throw "Caption exceeds two lines: $Subline" }
  $contentTop = [float]($sublineTop + $sublineMeasure.Height + 36 * $scale)
  try {
    $Graphics.DrawString("HabHub", $brandFont, $white, [float](128 * $scale), [float](49 * $scale))
    $categoryFormat = [System.Drawing.StringFormat]::new()
    $categoryFormat.Alignment = [System.Drawing.StringAlignment]::Far
    $Graphics.DrawString($Category, $categoryFont, $teal, [System.Drawing.RectangleF]::new([float]($Width - 480 * $scale), [float](57 * $scale), [float](414 * $scale), [float](30 * $scale)), $categoryFormat)
    $categoryFormat.Dispose()
    $Graphics.DrawString($Headline, $headlineFont, $white, [System.Drawing.RectangleF]::new($padding, $headlineTop, $textWidth, [float]($headlineMeasure.Height + 4 * $scale)))
    $Graphics.DrawString($Subline, $sublineFont, $muted, [System.Drawing.RectangleF]::new($padding, $sublineTop, $textWidth, [float]($sublineMeasure.Height + 4 * $scale)))
  } finally {
    $white.Dispose()
    $muted.Dispose()
    $teal.Dispose()
    $brandFont.Dispose()
    $categoryFont.Dispose()
    $headlineFont.Dispose()
    $sublineFont.Dispose()
  }
  return $contentTop
}

function Get-SceneCategory {
  param([string]$FileName)
  switch -Regex ($FileName) {
    "today|todo" { return "YOUR DAILY HOME" }
    "tracker|nutrition|timer" { return "MAKE IT PERSONAL" }
    "photo|progress|badges|avatar" { return "SEE YOUR PROGRESS" }
    "leaderboard|challenges|recap|group|chat" { return "BETTER TOGETHER" }
    "workout" { return "MOVE WITH PURPOSE" }
    "guide" { return "A SIMPLE START" }
    default { return "BUILT AROUND YOU" }
  }
}

function Draw-FrameFooter {
  param([System.Drawing.Graphics]$Graphics, [int]$Width, [int]$Height, [string]$Counter, [bool]$HasSyntheticPhotos)
  $scale = $Width / 1080.0
  $font = [System.Drawing.Font]::new("Segoe UI", [float](19 * $scale), [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $muted = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 159, 183, 200))
  $active = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 107, 218, 206))
  $inactive = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 48, 68, 85))
  try {
    $disclosure = if ($HasSyntheticPhotos) { "Synthetic demo photos" } else { "Real app. Demo data." }
    $Graphics.DrawString($disclosure, $font, $muted, [float](66 * $scale), [float]($Height - 45 * $scale))
    $numbers = [regex]::Matches($Counter, "\d+")
    if ($numbers.Count -ge 2) {
      $current = [int]$numbers[0].Value
      $total = [int]$numbers[1].Value
      $railWidth = [float](172 * $scale)
      $railX = [float]($Width - 66 * $scale - $railWidth)
      $railY = [float]($Height - 33 * $scale)
      $Graphics.FillRectangle($inactive, $railX, $railY, $railWidth, [float](4 * $scale))
      $Graphics.FillRectangle($active, $railX, $railY, [float]($railWidth * [Math]::Min(1.0, $current / [Math]::Max(1.0, $total))), [float](4 * $scale))
    }
  } finally { $font.Dispose(); $muted.Dispose(); $active.Dispose(); $inactive.Dispose() }
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
  $y = [float]([Math]::Max(40 * $scale, [Math]::Min($Height - 100 * $scale, $Height * $YFraction)))
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
    if (($source.Width -ne 420 -or $source.Height -ne 911) -and ($source.Width -ne 840 -or $source.Height -ne 1822)) {
      throw "Source capture must represent the 420x911 CSS viewport at 1x or 2x density, got $($source.Width)x$($source.Height): $InputPath"
    }
    $canvas = New-Canvas $Width $Height
    try {
      $fileName = [System.IO.Path]::GetFileName($InputPath)
      $headerHeight = Draw-BrandHeader $canvas.Graphics $Width $Height $Headline $Subline (Get-SceneCategory $fileName)
      $layoutScale = $Width / 1080.0
      if ($Callout) {
        Draw-InteractionCallout $canvas.Graphics $Width $Height $Callout ($headerHeight / $Height)
        $headerHeight += [float](86 * $layoutScale)
      }
      $bottomMargin = [float](76 * $layoutScale)
      $availableHeight = [float]($Height - $headerHeight - $bottomMargin)
      if ([System.IO.Path]::GetFileName($InputPath) -eq "04-photo-collage.jpg") {
        $timeline = [System.Drawing.Image]::FromFile((Join-Path $rawDirectory "04-photo-timeline.jpg"))
        try {
          $panelGap = [float](28 * $layoutScale)
          $panelHeight = [float](($availableHeight - $panelGap) * 0.56)
          $timelineWidth = [float]([Math]::Min($Width * 0.76, $panelHeight * 384 / 366))
          $timelineHeight = [float]($timelineWidth * (366 / 384))
          $timelineTarget = [System.Drawing.RectangleF]::new(
            [float]($Width * 0.10),
            [float]($headerHeight),
            $timelineWidth,
            $timelineHeight
          )
          Draw-ImageCropPanel $canvas.Graphics $timeline ([System.Drawing.RectangleF]::new(18, 0, 384, 366)) $timelineTarget ([float]($Width * 0.022))

          $collageWidth = [float]([Math]::Min($Width * 0.84, ($availableHeight - $panelGap - $timelineHeight) * 346 / 217))
          $collageHeight = [float]($collageWidth * (217 / 346))
          $collageTarget = [System.Drawing.RectangleF]::new(
            [float]($Width - $Width * 0.10 - $collageWidth),
            [float]($headerHeight + $timelineHeight + $panelGap),
            $collageWidth,
            $collageHeight
          )
          Draw-ImageCropPanel $canvas.Graphics $source ([System.Drawing.RectangleF]::new(37, 120, 346, 217)) $collageTarget ([float]($Width * 0.022))
        } finally {
          $timeline.Dispose()
        }
      } else {
        $sideMargin = [float]($Width * 0.065)
        $availableWidth = $Width - (2 * $sideMargin)
        $sourceRectangle = [System.Drawing.RectangleF]::new(0, 0, 420, 911)
        # The editor has an inline action plus a sticky duplicate. Keep one
        # authentic action in the detail crop instead of repeating both in art.
        if ($fileName -eq "15-custom-tracker.jpg") {
          $sourceRectangle = [System.Drawing.RectangleF]::new(0, 0, 420, 849)
        }
        # A 4:5 social card needs a closer real-app detail, not a miniature
        # phone or a screenshot drawn over its headline. Crops never invent UI.
        if ($Height / $Width -lt 1.5) {
          $sourceRectangle = switch ($fileName) {
            "01-today.jpg" { [System.Drawing.RectangleF]::new(0, 0, 420, 590) }
            "03-progress-grid.jpg" { [System.Drawing.RectangleF]::new(0, 0, 420, 490) }
            "19-recap-social.jpg" { [System.Drawing.RectangleF]::new(18, 205, 384, 550) }
            "15-custom-tracker.jpg" { [System.Drawing.RectangleF]::new(18, 0, 384, 420) }
            default { [System.Drawing.RectangleF]::new(0, 0, 420, 650) }
          }
        }
        $scale = [Math]::Min($availableWidth / $sourceRectangle.Width, $availableHeight / $sourceRectangle.Height)
        $targetWidth = [float]($sourceRectangle.Width * $scale)
        $targetHeight = [float]($sourceRectangle.Height * $scale)
        $targetX = [float](($Width - $targetWidth) / 2)
        $targetY = [float]($headerHeight + (($availableHeight - $targetHeight) / 2))
        $target = [System.Drawing.RectangleF]::new($targetX, $targetY, $targetWidth, $targetHeight)
        Draw-ImageCropPanel $canvas.Graphics $source $sourceRectangle $target ([float]($Width * 0.026))
      }
      Draw-FrameFooter $canvas.Graphics $Width $Height $Counter ($fileName -match "photo")
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
  $appleOutput = Join-Path $appleVideoFrameDirectory ("{0:D2}-{1}.png" -f $scene.Order, $scene.Id)
  New-StoreFrame $input $appleOutput 886 1920 $scene.Headline $scene.Subline ("{0:D2} / {1:D2}" -f $scene.Order, $scenes.Count)
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
  [pscustomobject]@{ Id = "today"; Raw = "01-today.jpg"; Headline = "A day that fits you."; Subline = "Your goals, habits and to-dos. All in one place." },
  [pscustomobject]@{ Id = "progress"; Raw = "03-progress-grid.jpg"; Headline = "Find your rhythm."; Subline = "Look back. Spot a pattern. Plan your next step." },
  [pscustomobject]@{ Id = "together"; Raw = "19-recap-social.jpg"; Headline = "Celebrate together."; Subline = "Turn a shared goal into a shared conversation." },
  [pscustomobject]@{ Id = "custom"; Raw = "15-custom-tracker.jpg"; Headline = "Make it your own."; Subline = "Reuse a tracker style for the goal you care about." }
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
  $headline = [System.Drawing.Font]::new("Segoe UI", 49, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $subline = [System.Drawing.Font]::new("Segoe UI", 21, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $brand = [System.Drawing.Font]::new("Segoe UI", 24, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $label = [System.Drawing.Font]::new("Segoe UI", 17, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  try {
    $graphics.DrawImage($mark, 54, 42, 52, 52)
    $graphics.DrawString("HabHub", $brand, $white, 116, 53)
    $graphics.DrawString("Your day.`nYour progress.`nYour people.", $headline, $white, [System.Drawing.RectangleF]::new(54, 125, 408, 192))
    $graphics.DrawString("A personal home for goals,`nworkouts and shared momentum.", $subline, $muted, [System.Drawing.RectangleF]::new(54, 337, 386, 65))
    $graphics.DrawString("Real app. Synthetic demo data.", $label, $teal, 54, 433)

    $panels = @(
      [pscustomobject]@{ File = "01-today.jpg"; X = 468; Y = 84 },
      [pscustomobject]@{ File = "03-progress-grid.jpg"; X = 643; Y = 48 },
      [pscustomobject]@{ File = "10-leaderboard.jpg"; X = 818; Y = 84 }
    )
    foreach ($panel in $panels) {
      $image = [System.Drawing.Image]::FromFile((Join-Path $rawDirectory $panel.File))
      try {
        Draw-ImagePanel $graphics $image ([System.Drawing.RectangleF]::new($panel.X, $panel.Y, 160, 347)) 16
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
  param([int]$Width = 1080, [int]$Height = 1920, [string]$OutputPath = "")
  $output = if ($OutputPath) { $OutputPath } else { Join-Path $videoFrameDirectory "13-habhub-outro.png" }
  $canvas = New-Canvas $Width $Height
  $graphics = $canvas.Graphics
  $scale = $Width / 1080.0
  $mark = [System.Drawing.Image]::FromFile((Join-Path $repoRoot "assets/images/habhub-splash-mark.png"))
  $white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
  $muted = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 189, 208, 222))
  $teal = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 107, 218, 206))
  $brand = [System.Drawing.Font]::new("Segoe UI", [float](46 * $scale), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $headline = [System.Drawing.Font]::new("Segoe UI", [float](88 * $scale), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $tagline = [System.Drawing.Font]::new("Segoe UI", [float](34 * $scale), [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $label = [System.Drawing.Font]::new("Segoe UI", [float](23 * $scale), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $center = [System.Drawing.StringFormat]::new()
  $center.Alignment = [System.Drawing.StringAlignment]::Center
  try {
    $markSize = [float](132 * $scale)
    $graphics.DrawImage($mark, [float](($Width - $markSize) / 2), [float]($Height * 0.075), $markSize, $markSize)
    $graphics.DrawString("HabHub", $brand, $white, [System.Drawing.RectangleF]::new(0, [float]($Height * 0.075 + 156 * $scale), $Width, [float](68 * $scale)), $center)
    $graphics.DrawString("Make today`nfeel like yours.", $headline, $white, [System.Drawing.RectangleF]::new([float](54 * $scale), [float]($Height * 0.25), [float]($Width - 108 * $scale), [float](264 * $scale)), $center)
    $graphics.DrawString("Start with a goal. Grow at your pace.", $tagline, $muted, [System.Drawing.RectangleF]::new([float](60 * $scale), [float]($Height * 0.25 + 292 * $scale), [float]($Width - 120 * $scale), [float](90 * $scale)), $center)
    $graphics.DrawString("habhub.expo.app", $label, $teal, [System.Drawing.RectangleF]::new(0, [float]($Height * 0.25 + 388 * $scale), $Width, [float](50 * $scale)), $center)

    $panelWidth = [float]($Width * 0.285)
    $panelHeight = [float]($panelWidth * 911 / 420)
    $panelTop = [float]($Height - 135 * $scale - $panelHeight)
    $panels = @(
      [pscustomobject]@{ File = "01-today.jpg"; X = $Width * 0.055; Y = $panelTop + 32 * $scale },
      [pscustomobject]@{ File = "03-progress-grid.jpg"; X = $Width * 0.3575; Y = $panelTop },
      [pscustomobject]@{ File = "10-leaderboard.jpg"; X = $Width * 0.66; Y = $panelTop + 32 * $scale }
    )
    foreach ($panel in $panels) {
      $image = [System.Drawing.Image]::FromFile((Join-Path $rawDirectory $panel.File))
      try {
        Draw-ImagePanel $graphics $image ([System.Drawing.RectangleF]::new([float]$panel.X, [float]$panel.Y, $panelWidth, $panelHeight)) ([float](22 * $scale))
      } finally {
        $image.Dispose()
      }
    }
    Draw-FrameFooter $graphics $Width $Height "" $false
    $canvas.Bitmap.Save($output, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $mark.Dispose()
    $white.Dispose()
    $muted.Dispose()
    $teal.Dispose()
    $brand.Dispose()
    $headline.Dispose()
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
$appleOutroFrame = New-VideoOutro 886 1920 (Join-Path $appleVideoFrameDirectory "13-habhub-outro.png")

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
  $appleVideoFrames = @(
    $storeVideoScenes | ForEach-Object {
      Join-Path $appleVideoFrameDirectory ("{0:D2}-{1}.png" -f $_.Order, $_.Id)
    }
  ) + @($appleOutroFrame)
  # Every duration is aligned to 30 fps. Independent fade-to-brand transitions
  # are robust across the software and hardware H.264 encoders used on Windows.
  New-FadeVideo $appleVideoFrames (Join-Path $appleVideoDirectory "habhub-apple-master-886x1920.mp4") 2.3 0.2 886 1920
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
