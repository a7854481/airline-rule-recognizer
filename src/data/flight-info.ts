// EXPORTS: IFlightInfo, MOCK_FLIGHT_INFO
export interface IFlightInfo {
  id: string
  airline: string
  flightNo: string
  cabinCode: string
  departureTime: string
}

export const MOCK_FLIGHT_INFO: IFlightInfo = {
  id: '1',
  airline: '东方航空',
  flightNo: 'MU5108',
  cabinCode: 'B',
  departureTime: '2026-07-18T11:00:00',
}