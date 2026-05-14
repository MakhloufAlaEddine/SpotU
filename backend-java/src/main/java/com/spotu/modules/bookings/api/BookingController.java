package com.spotu.modules.bookings.api;

import com.spotu.modules.bookings.dto.BookingDetailDto;
import com.spotu.modules.bookings.dto.BookingMeDto;
import com.spotu.modules.bookings.dto.BookingReceivedDto;
import com.spotu.modules.bookings.dto.BookingAcceptResponseDto;
import com.spotu.modules.bookings.dto.BookingCancelRequestDto;
import com.spotu.modules.bookings.dto.BookingCompleteResponseDto;
import com.spotu.modules.bookings.dto.BookingPayResponseDto;
import com.spotu.modules.bookings.dto.BookingRefuseResponseDto;
import com.spotu.error.ApiBadRequestException;
import com.spotu.modules.bookings.service.BookingBuyerService;
import com.spotu.modules.bookings.service.BookingReadService;
import com.spotu.modules.bookings.service.BookingWriteService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Locale;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class BookingController {

    private final BookingReadService bookingReadService;
    private final BookingWriteService bookingWriteService;
    private final BookingBuyerService bookingBuyerService;

    public BookingController(
            BookingReadService bookingReadService,
            BookingWriteService bookingWriteService,
            BookingBuyerService bookingBuyerService
    ) {
        this.bookingReadService = bookingReadService;
        this.bookingWriteService = bookingWriteService;
        this.bookingBuyerService = bookingBuyerService;
    }

    @GetMapping({"/bookings/me", "/users/me/bookings"})
    public ResponseEntity<List<BookingMeDto>> myBookings(HttpServletRequest request) {
        return ResponseEntity.ok(bookingReadService.getMyBookings(request));
    }

    @GetMapping({"/bookings/received", "/receiver/requests"})
    public ResponseEntity<List<BookingReceivedDto>> receivedBookings(HttpServletRequest request) {
        return ResponseEntity.ok(bookingReadService.getReceivedBookings(request));
    }

    @GetMapping("/bookings/{bookingId}")
    public ResponseEntity<BookingDetailDto> getBookingDetail(@PathVariable String bookingId, HttpServletRequest request) {
        return ResponseEntity.ok(bookingReadService.getBookingDetail(bookingId, request));
    }

    @PostMapping("/bookings/price-preview")
    public ResponseEntity<Map<String, Object>> bookingPricePreview(
            @RequestBody(required = false) Map<String, Object> body,
            HttpServletRequest request
    ) {
        return ResponseEntity.ok(bookingBuyerService.previewPrice(request, body == null ? Map.of() : body));
    }

    @PostMapping("/bookings/request")
    public ResponseEntity<Map<String, Object>> requestBooking(
            @RequestBody(required = false) Map<String, Object> body,
            HttpServletRequest request
    ) {
        return ResponseEntity.ok(bookingBuyerService.requestBooking(request, body == null ? Map.of() : body));
    }

    @PostMapping("/bookings")
    public ResponseEntity<Map<String, Object>> createBookingAlias(
            @RequestBody(required = false) Map<String, Object> body,
            HttpServletRequest request
    ) {
        return ResponseEntity.ok(bookingBuyerService.requestBooking(request, body == null ? Map.of() : body));
    }

    @PostMapping("/bookings/{bookingId}/pay")
    public ResponseEntity<BookingPayResponseDto> payBooking(
            @PathVariable String bookingId,
            @RequestBody(required = false) Map<String, Object> body,
            HttpServletRequest request
    ) {
        return ResponseEntity.ok(bookingBuyerService.payBooking(bookingId, request, body == null ? Map.of() : body));
    }

    @PostMapping("/bookings/{bookingId}/refuse")
    public ResponseEntity<BookingRefuseResponseDto> refuseBooking(@PathVariable String bookingId, HttpServletRequest request) {
        return ResponseEntity.ok(bookingWriteService.refuseBooking(bookingId, request));
    }

    @PostMapping("/bookings/{bookingId}/accept")
    public ResponseEntity<BookingAcceptResponseDto> acceptBooking(@PathVariable String bookingId, HttpServletRequest request) {
        return ResponseEntity.ok(bookingWriteService.acceptBooking(bookingId, request));
    }

    @PostMapping("/bookings/{bookingId}/complete")
    public ResponseEntity<BookingCompleteResponseDto> completeBooking(@PathVariable String bookingId, HttpServletRequest request) {
        return ResponseEntity.ok(bookingWriteService.completeBooking(bookingId, request));
    }

    @PostMapping("/bookings/{bookingId}/cancel")
    public ResponseEntity<Map<String, Object>> cancelBooking(
            @PathVariable String bookingId,
            @RequestBody(required = false) BookingCancelRequestDto body,
            HttpServletRequest request
    ) {
        return ResponseEntity.ok(bookingWriteService.cancelBooking(bookingId, body, request));
    }

    @PatchMapping("/bookings/{bookingId}/status")
    public ResponseEntity<Object> patchBookingStatusAlias(
            @PathVariable String bookingId,
            @RequestBody(required = false) Map<String, Object> body,
            HttpServletRequest request
    ) {
        String status = body == null || body.get("status") == null ? "" : String.valueOf(body.get("status"))
                .trim()
                .toLowerCase(Locale.ROOT);

        return switch (status) {
            case "accepted", "confirmed" -> ResponseEntity.ok(bookingWriteService.acceptBooking(bookingId, request));
            case "refused" -> ResponseEntity.ok(bookingWriteService.refuseBooking(bookingId, request));
            case "completed" -> ResponseEntity.ok(bookingWriteService.completeBooking(bookingId, request));
            case "cancelled", "canceled" -> {
                String reason = body == null ? null : (body.get("reason") == null ? null : String.valueOf(body.get("reason")));
                yield ResponseEntity.ok(bookingWriteService.cancelBooking(bookingId, new BookingCancelRequestDto(reason), request));
            }
            default -> throw new ApiBadRequestException("Statut booking non supporté pour cet alias legacy");
        };
    }
}
