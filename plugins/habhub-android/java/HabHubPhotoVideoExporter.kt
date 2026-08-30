package __ANDROID_PACKAGE__

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Typeface
import android.media.ExifInterface
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import com.facebook.react.bridge.ReadableArray
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.ceil
import kotlin.math.max

/**
 * Small, dependency-free Android slideshow encoder. Frames are drawn locally,
 * encoded as H.264 through the platform MediaCodec, and muxed into a real MP4.
 * Only one decoded source photo and one encoded YUV frame are retained at once.
 */
object HabHubPhotoVideoExporter {
  private const val WIDTH = 720
  private const val HEIGHT = 960
  private const val FRAME_RATE = 20
  private const val BIT_RATE = 2_000_000
  private const val MAX_IMAGE_BYTES = 40 * 1024 * 1024

  private data class Frame(
    val uri: String,
    val date: String,
    val metadata: List<String>,
  )

  fun create(
    context: Context,
    readableFrames: ReadableArray,
    frameDurationMs: Double,
  ): File {
    val frames = (0 until readableFrames.size()).mapNotNull { index ->
      val row = readableFrames.getMap(index) ?: return@mapNotNull null
      val uri = row.getString("uri")?.trim().orEmpty()
      if (uri.isEmpty()) return@mapNotNull null
      val metadata = row.getArray("metadata")
      Frame(
        uri = uri,
        date = row.getString("date")?.trim().orEmpty(),
        metadata = if (metadata == null) emptyList() else
          (0 until metadata.size()).mapNotNull { item ->
            metadata.getString(item)?.trim()?.takeIf(String::isNotEmpty)
          },
      )
    }
    require(frames.size >= 2) { "Add at least two available photos first." }

    val exportDirectory = File(context.cacheDir, "photo-progress-video")
    exportDirectory.mkdirs()
    exportDirectory.listFiles()?.forEach { file ->
      if (System.currentTimeMillis() - file.lastModified() > 24 * 60 * 60 * 1_000L)
        file.delete()
    }
    val output = File(exportDirectory, "habhub-photo-progress-${System.currentTimeMillis()}.mp4")
    encode(context, frames, frameDurationMs, output)
    require(output.isFile && output.length() > 0L) { "Android could not create the MP4 file." }
    return output
  }

  fun save(context: Context, source: File): String {
    require(source.isFile && source.length() > 0L) { "The exported video is no longer available." }
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q)
      throw IllegalStateException("Use Share video to save this file on Android 9 or earlier.")

    val name = "HabHub-photo-progress-${
      SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())
    }.mp4"
    val values = ContentValues().apply {
      put(MediaStore.Video.Media.DISPLAY_NAME, name)
      put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
      put(MediaStore.Video.Media.RELATIVE_PATH, "${Environment.DIRECTORY_MOVIES}/HabHub")
      put(MediaStore.Video.Media.IS_PENDING, 1)
    }
    val resolver = context.contentResolver
    val target = resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values)
      ?: throw IllegalStateException("Android could not create a Movies file.")
    try {
      resolver.openOutputStream(target, "w")?.use { output ->
        source.inputStream().use { input -> input.copyTo(output) }
      } ?: throw IllegalStateException("Android could not write the Movies file.")
      values.clear()
      values.put(MediaStore.Video.Media.IS_PENDING, 0)
      resolver.update(target, values, null, null)
      return name
    } catch (error: Throwable) {
      resolver.delete(target, null, null)
      throw error
    }
  }

  private fun encode(
    context: Context,
    frames: List<Frame>,
    requestedFrameDurationMs: Double,
    output: File,
  ) {
    val mime = MediaFormat.MIMETYPE_VIDEO_AVC
    val format = MediaFormat.createVideoFormat(mime, WIDTH, HEIGHT).apply {
      setInteger(
        MediaFormat.KEY_COLOR_FORMAT,
        MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible,
      )
      setInteger(MediaFormat.KEY_BIT_RATE, BIT_RATE)
      setInteger(MediaFormat.KEY_FRAME_RATE, FRAME_RATE)
      setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
    }
    val codec = MediaCodec.createEncoderByType(mime)
    var muxer: MediaMuxer? = null
    var muxerStarted = false
    var trackIndex = -1
    val bufferInfo = MediaCodec.BufferInfo()
    var frameNumber = 0L
    var encodingCompleted = false
    val repeats = max(
      1,
      ceil(requestedFrameDurationMs.coerceIn(50.0, 2_000.0) * FRAME_RATE / 1_000.0).toInt(),
    )

    fun drain(endOfStream: Boolean): Boolean {
      var idleRounds = 0
      while (true) {
        val outputIndex = codec.dequeueOutputBuffer(bufferInfo, if (endOfStream) 20_000 else 0)
        when {
          outputIndex == MediaCodec.INFO_TRY_AGAIN_LATER -> {
            if (!endOfStream || ++idleRounds >= 250) return false
          }
          outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
            check(!muxerStarted) { "The video encoder changed format twice." }
            trackIndex = muxer!!.addTrack(codec.outputFormat)
            muxer!!.start()
            muxerStarted = true
          }
          outputIndex >= 0 -> {
            val encoded = codec.getOutputBuffer(outputIndex)
              ?: throw IllegalStateException("The video encoder returned an empty buffer.")
            if (bufferInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0)
              bufferInfo.size = 0
            if (bufferInfo.size > 0) {
              check(muxerStarted) { "The MP4 muxer did not start." }
              encoded.position(bufferInfo.offset)
              encoded.limit(bufferInfo.offset + bufferInfo.size)
              muxer!!.writeSampleData(trackIndex, encoded, bufferInfo)
            }
            val ended = bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
            codec.releaseOutputBuffer(outputIndex, false)
            if (ended) return true
          }
        }
      }
    }

    fun queueFrame(yuv: Triple<ByteArray, ByteArray, ByteArray>) {
      while (true) {
        val inputIndex = codec.dequeueInputBuffer(20_000)
        if (inputIndex < 0) {
          drain(false)
          continue
        }
        val image = codec.getInputImage(inputIndex)
          ?: throw IllegalStateException("This device's H.264 encoder does not expose YUV input.")
        // queueInputBuffer transfers the writable Image back to MediaCodec;
        // closing it first would discard the frame on affected vendor codecs.
        writePlane(image.planes[0], yuv.first, WIDTH, HEIGHT)
        writePlane(image.planes[1], yuv.second, WIDTH / 2, HEIGHT / 2)
        writePlane(image.planes[2], yuv.third, WIDTH / 2, HEIGHT / 2)
        codec.queueInputBuffer(
          inputIndex,
          0,
          WIDTH * HEIGHT * 3 / 2,
          frameNumber * 1_000_000L / FRAME_RATE,
          0,
        )
        frameNumber += 1
        drain(false)
        return
      }
    }

    try {
      codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
      codec.start()
      muxer = MediaMuxer(output.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
      frames.forEach { frame ->
        val bitmap = renderFrame(context, frame)
        val yuv = try {
          bitmapToYuv420(bitmap)
        } finally {
          bitmap.recycle()
        }
        repeat(repeats) { queueFrame(yuv) }
      }
      while (true) {
        val inputIndex = codec.dequeueInputBuffer(20_000)
        if (inputIndex < 0) {
          drain(false)
          continue
        }
        codec.queueInputBuffer(
          inputIndex,
          0,
          0,
          frameNumber * 1_000_000L / FRAME_RATE,
          MediaCodec.BUFFER_FLAG_END_OF_STREAM,
        )
        break
      }
      check(drain(true)) { "The video encoder did not finish." }
      encodingCompleted = true
    } catch (error: Throwable) {
      output.delete()
      throw error
    } finally {
      try { codec.stop() } catch (_: Throwable) {}
      try { codec.release() } catch (_: Throwable) {}
      var muxerStopFailure: Throwable? = null
      if (muxerStarted) try {
        muxer?.stop()
      } catch (error: Throwable) {
        muxerStopFailure = error
      }
      try { muxer?.release() } catch (_: Throwable) {}
      if (encodingCompleted && muxerStopFailure != null) {
        output.delete()
        throw IllegalStateException("Android could not finalize the MP4 file.", muxerStopFailure)
      }
    }
  }

  private fun writePlane(
    plane: android.media.Image.Plane,
    values: ByteArray,
    width: Int,
    height: Int,
  ) {
    val buffer = plane.buffer
    val rowStride = plane.rowStride
    val pixelStride = plane.pixelStride
    for (row in 0 until height) {
      val sourceOffset = row * width
      val targetOffset = row * rowStride
      for (column in 0 until width) {
        val index = targetOffset + column * pixelStride
        if (index < buffer.capacity()) buffer.put(index, values[sourceOffset + column])
      }
    }
  }

  private fun bitmapToYuv420(bitmap: Bitmap): Triple<ByteArray, ByteArray, ByteArray> {
    val pixels = IntArray(WIDTH * HEIGHT)
    bitmap.getPixels(pixels, 0, WIDTH, 0, 0, WIDTH, HEIGHT)
    val y = ByteArray(WIDTH * HEIGHT)
    val u = ByteArray(WIDTH * HEIGHT / 4)
    val v = ByteArray(WIDTH * HEIGHT / 4)
    for (row in 0 until HEIGHT) {
      for (column in 0 until WIDTH) {
        val color = pixels[row * WIDTH + column]
        val red = Color.red(color)
        val green = Color.green(color)
        val blue = Color.blue(color)
        y[row * WIDTH + column] = clampByte(((66 * red + 129 * green + 25 * blue + 128) shr 8) + 16)
        if (row % 2 == 0 && column % 2 == 0) {
          val chromaIndex = row / 2 * (WIDTH / 2) + column / 2
          u[chromaIndex] = clampByte(((-38 * red - 74 * green + 112 * blue + 128) shr 8) + 128)
          v[chromaIndex] = clampByte(((112 * red - 94 * green - 18 * blue + 128) shr 8) + 128)
        }
      }
    }
    return Triple(y, u, v)
  }

  private fun clampByte(value: Int) = value.coerceIn(0, 255).toByte()

  private fun renderFrame(context: Context, frame: Frame): Bitmap {
    val source = decodeBitmap(context, frame.uri)
      ?: throw IllegalStateException("A selected photo could not be decoded.")
    try {
      val output = Bitmap.createBitmap(WIDTH, HEIGHT, Bitmap.Config.ARGB_8888)
      try {
        val canvas = Canvas(output)
        canvas.drawColor(Color.rgb(245, 247, 242))
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
          color = Color.rgb(23, 33, 27)
          typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
          textSize = 25f
        }
        canvas.drawText("HabHub photo progress", 36f, 50f, paint)
        drawCover(canvas, source, RectF(36f, 78f, (WIDTH - 36).toFloat(), (HEIGHT - 182).toFloat()), paint)
        paint.textAlign = Paint.Align.CENTER
        paint.textSize = 24f
        canvas.drawText(frame.date, WIDTH / 2f, HEIGHT - 130f, paint)
        paint.color = Color.rgb(23, 107, 77)
        paint.textSize = 17f
        frame.metadata.take(3).forEachIndexed { index, text ->
          canvas.drawText(text, WIDTH / 2f, HEIGHT - 96f + index * 25f, paint)
        }
        return output
      } catch (error: Throwable) {
        output.recycle()
        throw error
      }
    } finally {
      source.recycle()
    }
  }

  private fun drawCover(canvas: Canvas, bitmap: Bitmap, target: RectF, paint: Paint) {
    val scale = max(target.width() / bitmap.width, target.height() / bitmap.height)
    val sourceWidth = target.width() / scale
    val sourceHeight = target.height() / scale
    val left = (bitmap.width - sourceWidth) / 2f
    val top = (bitmap.height - sourceHeight) / 2f
    canvas.drawBitmap(
      bitmap,
      Rect(
        left.toInt(),
        top.toInt(),
        (left + sourceWidth).toInt(),
        (top + sourceHeight).toInt(),
      ),
      target,
      paint,
    )
  }

  private fun decodeBitmap(context: Context, uriText: String): Bitmap? {
    val bytes = open(context, uriText).use { input -> readBounded(input) }
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    var sample = 1
    while (bounds.outWidth / sample > WIDTH * 2 || bounds.outHeight / sample > HEIGHT * 2)
      sample *= 2
    val decoded = BitmapFactory.decodeByteArray(
      bytes,
      0,
      bytes.size,
      BitmapFactory.Options().apply { inSampleSize = sample },
    ) ?: return null
    val orientation = try {
      ExifInterface(ByteArrayInputStream(bytes)).getAttributeInt(
        ExifInterface.TAG_ORIENTATION,
        ExifInterface.ORIENTATION_NORMAL,
      )
    } catch (_: Throwable) {
      ExifInterface.ORIENTATION_NORMAL
    }
    val matrix = Matrix()
    when (orientation) {
      ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
      ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
      ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
      ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.postScale(-1f, 1f)
      ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.postScale(1f, -1f)
      ExifInterface.ORIENTATION_TRANSPOSE -> { matrix.postScale(-1f, 1f); matrix.postRotate(270f) }
      ExifInterface.ORIENTATION_TRANSVERSE -> { matrix.postScale(-1f, 1f); matrix.postRotate(90f) }
    }
    if (matrix.isIdentity) return decoded
    val oriented = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
    if (oriented !== decoded) decoded.recycle()
    return oriented
  }

  private fun open(context: Context, uriText: String): InputStream {
    if (uriText.startsWith("data:", ignoreCase = true)) {
      val encoded = uriText.substringAfter(',', "")
      return ByteArrayInputStream(android.util.Base64.decode(encoded, android.util.Base64.DEFAULT))
    }
    val uri = Uri.parse(uriText)
    if (uri.scheme == "content" || uri.scheme == "file")
      return context.contentResolver.openInputStream(uri)
        ?: throw IllegalStateException("A selected photo could not be opened.")
    if (uri.scheme == "http" || uri.scheme == "https") {
      val connection = URL(uriText).openConnection() as HttpURLConnection
      connection.connectTimeout = 15_000
      connection.readTimeout = 30_000
      connection.instanceFollowRedirects = true
      connection.connect()
      if (connection.responseCode !in 200..299) {
        connection.disconnect()
        throw IllegalStateException("A cloud photo could not be downloaded (${connection.responseCode}).")
      }
      return object : InputStream() {
        private val delegate = connection.inputStream
        override fun read() = delegate.read()
        override fun read(buffer: ByteArray, offset: Int, length: Int) = delegate.read(buffer, offset, length)
        override fun close() { delegate.close(); connection.disconnect() }
      }
    }
    return File(uriText).inputStream()
  }

  private fun readBounded(input: InputStream): ByteArray {
    val output = ByteArrayOutputStream()
    val buffer = ByteArray(16 * 1024)
    var total = 0
    while (true) {
      val read = input.read(buffer)
      if (read < 0) break
      total += read
      require(total <= MAX_IMAGE_BYTES) { "A selected photo is too large to export safely." }
      output.write(buffer, 0, read)
    }
    return output.toByteArray()
  }

  fun fileFromUri(uriText: String): File {
    val uri = Uri.parse(uriText)
    require(uri.scheme == "file") { "The video file URI is invalid." }
    return File(requireNotNull(uri.path) { "The video file path is missing." })
  }
}
