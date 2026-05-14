package com.spotu.modules.bookings.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.spotu.error.ApiForbiddenException;
import com.spotu.error.ApiNotFoundException;
import com.spotu.modules.auth.dto.CurrentUserDto;
import com.spotu.modules.auth.service.AuthMeService;
import com.spotu.modules.bookings.dto.BookingDetailDto;
import com.spotu.modules.bookings.dto.BookingMeDto;
import com.spotu.modules.bookings.dto.BookingReceivedDto;
import com.spotu.modules.bookings.infra.BookingReadRepository;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Objects;

@Service
public class BookingReadService {

    private final AuthMeService authMeService;
    private final BookingReadRepository bookingReadRepository;
    private final ObjectMapper objectMapper;

    public BookingReadService(
            AuthMeService authMeService,
            BookingReadRepository bookingReadRepository,
            ObjectMapper objectMapper
    ) {
        this.authMeService = authMeService;
        this.bookingReadRepository = bookingReadRepository;
        this.objectMapper = objectMapper;
    }

    public List<BookingMeDto> getMyBookings(HttpServletRequest request) {
        CurrentUserDto me = authMeService.requireCurrentUser(request);
        return bookingReadRepository.findMyBookings(me.userId()).stream().map(this::toBookingMeDto).toList();
    }

    public List<BookingReceivedDto> getReceivedBookings(HttpServletRequest request) {
        CurrentUserDto me = authMeService.requireCurrentUser(request);
        return bookingReadRepository.findReceivedBookings(me.userId()).stream().map(this::toBookingReceivedDto).toList();
    }

    public BookingDetailDto getBookingDetail(String bookingId, HttpServletRequest request) {
        CurrentUserDto me = authMeService.requireCurrentUser(request);
        BookingReadRepository.BookingDetailRow row = bookingReadRepository.findBookingDetail(bookingId)
                .orElseThrow(() -> new ApiNotFoundException("Réservation introuvable"));

        BookingReadRepository.BookingBaseFields base = row.base();
        boolean allowed = Objects.equals(me.userId(), base.userId())
                || Objects.equals(me.userId(), base.payerUserId())
                || Objects.equals(me.userId(), base.receiverUserId())
                || Objects.equals(me.userId(), base.coachId())
                || Objects.equals(me.role(), "admin");
        if (!allowed) {
            throw new ApiForbiddenException("Accès refusé");
        }

        return toBookingDetailDto(row);
    }

    private BookingMeDto toBookingMeDto(BookingReadRepository.BookingMeRow row) {
        BookingReadRepository.BookingBaseFields b = row.base();
        return new BookingMeDto(
                b.bookingId(),
                b.serviceId(),
                b.userId(),
                b.coachId(),
                b.status(),
                b.scheduledAt(),
                b.slotId(),
                b.locationId(),
                b.notes(),
                b.amount(),
                b.paymentStatus(),
                b.payerUserId(),
                b.receiverUserId(),
                deserializePossiblyJson(b.pricingSnapshot()),
                b.idempotencyKey(),
                b.currency(),
                b.createdAt(),
                b.updatedAt(),
                b.expiresAt(),
                b.cancelledByUserId(),
                b.cancellationReason(),
                b.paymentMode(),
                row.serviceTitle(),
                row.address(),
                row.receiverName(),
                row.receiverPicture(),
                row.slotStartTime(),
                row.slotEndTime(),
                row.slotDate(),
                row.slotType()
        );
    }

    private BookingReceivedDto toBookingReceivedDto(BookingReadRepository.BookingReceivedRow row) {
        BookingReadRepository.BookingBaseFields b = row.base();
        return new BookingReceivedDto(
                b.bookingId(),
                b.serviceId(),
                b.userId(),
                b.coachId(),
                b.status(),
                b.scheduledAt(),
                b.slotId(),
                b.locationId(),
                b.notes(),
                b.amount(),
                b.paymentStatus(),
                b.payerUserId(),
                b.receiverUserId(),
                deserializePossiblyJson(b.pricingSnapshot()),
                b.idempotencyKey(),
                b.currency(),
                b.createdAt(),
                b.updatedAt(),
                b.expiresAt(),
                b.cancelledByUserId(),
                b.cancellationReason(),
                b.paymentMode(),
                row.serviceTitle(),
                row.payerName()
        );
    }

    private BookingDetailDto toBookingDetailDto(BookingReadRepository.BookingDetailRow row) {
        BookingReadRepository.BookingBaseFields b = row.base();
        return new BookingDetailDto(
                b.bookingId(),
                b.serviceId(),
                b.userId(),
                b.coachId(),
                b.status(),
                b.scheduledAt(),
                b.slotId(),
                b.locationId(),
                b.notes(),
                b.amount(),
                b.paymentStatus(),
                b.payerUserId(),
                b.receiverUserId(),
                deserializePossiblyJson(b.pricingSnapshot()),
                b.idempotencyKey(),
                b.currency(),
                b.createdAt(),
                b.updatedAt(),
                b.expiresAt(),
                b.cancelledByUserId(),
                b.cancellationReason(),
                b.paymentMode(),
                row.serviceTitle(),
                row.address(),
                deserializePossiblyJson(row.serviceImages()),
                row.serviceDescription(),
                row.receiverName(),
                row.receiverPicture(),
                row.payerName(),
                row.payerPicture(),
                row.slotStartTime(),
                row.slotEndTime(),
                row.slotDate(),
                row.slotType()
        );
    }

    private Object deserializePossiblyJson(Object value) {
        if (!(value instanceof String raw)) {
            return value;
        }
        if (raw.isBlank()) {
            return raw;
        }
        try {
            return objectMapper.readValue(raw, new TypeReference<>() {
            });
        } catch (Exception ignored) {
            return raw;
        }
    }
}
